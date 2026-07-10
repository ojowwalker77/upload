import { Effect, Layer, Option } from "effect"
import { createHash } from "node:crypto"
import { ProcessingError } from "../domain.js"
import type { Chunk, GeminiError, IngestSource } from "../domain.js"
import { Ffmpeg } from "./Ffmpeg.js"
import { Gemini } from "./Gemini.js"
import { Processor } from "./Processor.js"
import { Transcriber } from "./Transcriber.js"

const MAX_INLINE_BYTES = 19 * 1024 * 1024
const SUMMARY_THRESHOLD = 2000
const FRAME_CONCURRENCY = 3

export interface ChunkOptions {
  readonly size?: number
  readonly overlap?: number
}

/**
 * Split text into overlapping chunks, preferring paragraph then sentence
 * boundaries before falling back to a hard cut.
 */
export const chunkText = (text: string, options?: ChunkOptions): Array<string> => {
  const size = options?.size ?? 1600
  const overlap = Math.min(options?.overlap ?? 200, size - 1)
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  if (trimmed.length <= size) return [trimmed]

  const chunks: Array<string> = []
  let start = 0
  while (start < trimmed.length) {
    let end = Math.min(start + size, trimmed.length)
    if (end < trimmed.length) {
      const window = trimmed.slice(start, end)
      const paragraph = window.lastIndexOf("\n\n")
      const sentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf(".\n"),
        window.lastIndexOf("? "),
        window.lastIndexOf("! ")
      )
      // only take a boundary if it keeps the chunk usefully sized
      if (paragraph > size / 2) end = start + paragraph
      else if (sentence > size / 2) end = start + sentence + 1
    }
    const piece = trimmed.slice(start, end).trim()
    if (piece.length > 0) chunks.push(piece)
    if (end >= trimmed.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}

const documentIdOf = (data: Uint8Array): string =>
  createHash("sha256").update(data).digest("hex").slice(0, 16)

const toChunks = (
  source: IngestSource,
  documentId: string,
  texts: ReadonlyArray<string>,
  extraMetadata: (index: number) => Readonly<Record<string, string>> = () => ({})
): Array<Chunk> =>
  texts.map((text, index) => ({
    id: `${documentId}:${index}`,
    documentId,
    sourcePath: source.path,
    kind: source.kind,
    index,
    text,
    metadata: { path: source.path, mimeType: source.mimeType, ...extraMetadata(index) }
  }))

/**
 * Normalizes every modality to text chunks. Audio/image/video ALWAYS pass
 * through the Ffmpeg conditioning stage before any model sees bytes:
 *   audio → ffmpeg (16k mono wav) → Transcriber (whisper)
 *   video → ffmpeg (key frames + audio track) → Gemini describe + Transcriber
 *   image → ffmpeg (downscale/strip/jpeg) → Gemini describe
 *   pdf   → Gemini extract · text → chunked raw (+ summary when long)
 */
export const ProcessorLive: Layer.Layer<Processor, never, Gemini | Ffmpeg | Transcriber> =
  Layer.effect(
    Processor,
    Effect.gen(function* () {
      const gemini = yield* Gemini
      const ffmpeg = yield* Ffmpeg
      const transcriber = yield* Transcriber

      const describeFrames = (
        source: IngestSource,
        frames: ReadonlyArray<Uint8Array>
      ): Effect.Effect<ReadonlyArray<string>, GeminiError> =>
        Effect.forEach(
          frames,
          (frame, i) =>
            gemini.describeMedia({
              mimeType: "image/jpeg",
              data: frame,
              prompt: `This is key frame ${i + 1} of ${frames.length} from a video. Describe it factually: subjects, actions, on-screen text, setting.`
            }),
          { concurrency: FRAME_CONCURRENCY }
        )

      return Processor.of({
        process: (source) =>
          Effect.gen(function* () {
            const documentId = documentIdOf(source.data)

            switch (source.kind) {
              case "text": {
                const text = yield* Effect.try({
                  try: () => new TextDecoder("utf-8", { fatal: true }).decode(source.data),
                  catch: (cause) =>
                    new ProcessingError({ path: source.path, detail: "file is not valid UTF-8", cause })
                })
                const bodyChunks = chunkText(text)
                if (text.length <= SUMMARY_THRESHOLD) {
                  return toChunks(source, documentId, bodyChunks)
                }
                const summary = yield* gemini.generateText(
                  `Summarize the following document in one dense paragraph, keeping key names, numbers and conclusions:\n\n${text.slice(0, 8000)}`
                )
                return toChunks(source, documentId, [summary, ...bodyChunks], (index) =>
                  index === 0 ? { summary: "true" } : {}
                )
              }

              case "audio": {
                const optimized = yield* ffmpeg.optimizeAudio(source)
                const transcript = yield* transcriber.transcribe({
                  path: source.path,
                  data: optimized.data,
                  mimeType: optimized.mimeType
                })
                return toChunks(source, documentId, chunkText(transcript), () => ({
                  transcript: "true"
                }))
              }

              case "video": {
                const extracted = yield* ffmpeg.extractVideo(source)
                const [descriptions, transcript] = yield* Effect.all(
                  [
                    describeFrames(source, extracted.frames),
                    Option.match(extracted.audio, {
                      onNone: () => Effect.succeed(""),
                      onSome: (audio) =>
                        transcriber.transcribe({
                          path: source.path,
                          data: audio.data,
                          mimeType: audio.mimeType
                        })
                    })
                  ],
                  { concurrency: 2 }
                )
                const combined = [
                  transcript.length > 0 ? `Transcript:\n${transcript}` : "",
                  "Key frames:",
                  ...descriptions.map((d, i) => `Frame ${i + 1}: ${d}`)
                ]
                  .filter((s) => s.length > 0)
                  .join("\n\n")
                return toChunks(source, documentId, chunkText(combined), () => ({
                  frames: String(extracted.frames.length)
                }))
              }

              case "image": {
                const optimized = yield* ffmpeg.optimizeImage(source)
                const described = yield* gemini.describeMedia({
                  mimeType: optimized.mimeType,
                  data: optimized.data,
                  prompt: "Describe this image in detail: subjects, text (OCR), layout, colors, context."
                })
                return toChunks(source, documentId, chunkText(described))
              }

              case "pdf": {
                if (source.data.byteLength > MAX_INLINE_BYTES) {
                  return yield* Effect.fail(
                    new ProcessingError({
                      path: source.path,
                      detail: `file is ${source.data.byteLength} bytes; inline Gemini requests are limited to ~19 MB — split the file or wait for Files API support`
                    })
                  )
                }
                const described = yield* gemini.describeMedia({
                  mimeType: source.mimeType,
                  data: source.data,
                  prompt:
                    "Extract the full text of this PDF, preserving structure. Render tables as GitHub-flavored markdown tables."
                })
                return toChunks(source, documentId, chunkText(described))
              }

              case "mix":
                return yield* Effect.fail(
                  new ProcessingError({
                    path: source.path,
                    detail: "mix sources are decomposed by the pipeline, not the processor"
                  })
                )
            }
          })
      })
    })
  )
