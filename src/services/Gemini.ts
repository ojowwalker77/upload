import { Context } from "effect"
import type { Effect } from "effect"
import type { GeminiError } from "../domain.js"

/**
 * The single seam to Google. Gemini Flash natively understands audio, video,
 * images and PDFs, so the whole diagram (Whisper, key-frame extraction, PDF
 * text/tables) collapses into `describeMedia` with a modality-specific prompt.
 *
 * Implementations: GeminiLive (REST via @effect/platform HttpClient) and
 * GeminiMock (deterministic, offline — for tests and keyless runs).
 */
export interface GeminiService {
  /** Text-in, text-out (summaries, descriptions of plain text). */
  readonly generateText: (prompt: string) => Effect.Effect<string, GeminiError>

  /** Media-in, text-out: transcript / description / extracted text. */
  readonly describeMedia: (input: {
    readonly mimeType: string
    readonly data: Uint8Array
    readonly prompt: string
  }) => Effect.Effect<string, GeminiError>

  /** Batch-embed texts. All vectors have the configured dimensionality. */
  readonly embed: (
    texts: ReadonlyArray<string>,
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
  ) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, GeminiError>
}

export class Gemini extends Context.Tag("upload-world/Gemini")<Gemini, GeminiService>() {}
