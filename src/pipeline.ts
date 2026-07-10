import { FileSystem } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, Either } from "effect"
import type {
  EmbeddedChunk,
  GeminiError,
  MediaKind,
  ProcessingError,
  SearchHit,
  UnsupportedMediaError,
  VectorStoreError
} from "./domain.js"
import { detectMedia } from "./services/Router.js"
import { Gemini } from "./services/Gemini.js"
import { Processor } from "./services/Processor.js"
import { VectorStore } from "./services/VectorStore.js"

export interface IngestResult {
  readonly documentId: string
  readonly path: string
  readonly kind: MediaKind
  readonly chunks: number
}

export interface IngestReport {
  readonly results: ReadonlyArray<IngestResult>
  readonly skipped: ReadonlyArray<{ readonly path: string; readonly reason: string }>
}

const EMBED_BATCH = 100

const embedChunks = (
  chunks: ReadonlyArray<{ readonly text: string }>
): Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, GeminiError, Gemini> =>
  Effect.gen(function* () {
    const gemini = yield* Gemini
    const vectors: Array<ReadonlyArray<number>> = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)
      const embedded = yield* gemini.embed(batch.map((c) => c.text), "RETRIEVAL_DOCUMENT")
      vectors.push(...embedded)
    }
    return vectors
  })

/**
 * Ingest raw bytes under a (file)name — the name only drives modality routing
 * and provenance metadata, so this works for uploads that never touch disk.
 */
export const ingestData = (
  path: string,
  data: Uint8Array
): Effect.Effect<
  IngestResult,
  GeminiError | ProcessingError | VectorStoreError | UnsupportedMediaError,
  Gemini | Processor | VectorStore
> =>
  Effect.gen(function* () {
    const processor = yield* Processor
    const store = yield* VectorStore

    const media = yield* detectMedia(path)
    const chunks = yield* processor.process({ path, data, ...media })
    const vectors = yield* embedChunks(chunks)
    const embedded: Array<EmbeddedChunk> = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: vectors[i] ?? []
    }))
    yield* store.upsert(embedded)

    const documentId = embedded[0]?.documentId ?? "empty"
    return { documentId, path, kind: media.kind, chunks: embedded.length }
  })

/** Ingest one file from disk: read → route → normalize → embed → store. */
export const ingestPath = (
  path: string
): Effect.Effect<
  IngestResult,
  PlatformError | GeminiError | ProcessingError | VectorStoreError | UnsupportedMediaError,
  FileSystem.FileSystem | Gemini | Processor | VectorStore
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const data = yield* fs.readFile(path)
    return yield* ingestData(path, data)
  })

const collectFiles = (
  root: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(root)
    if (info.type !== "Directory") return [root]

    const out: Array<string> = []
    const walk = (dir: string): Effect.Effect<void, PlatformError> =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectory(dir)
        for (const name of entries) {
          if (name.startsWith(".")) continue
          const full = `${dir}/${name}`
          const stat = yield* fs.stat(full)
          if (stat.type === "Directory") yield* walk(full)
          else if (stat.type === "File") out.push(full)
        }
      })
    yield* walk(root)
    return out
  })

/**
 * Ingest files and directories (recursed). Unsupported and unreadable inputs
 * are reported in `skipped` rather than failing the batch.
 */
export const ingestPaths = (
  paths: ReadonlyArray<string>
): Effect.Effect<
  IngestReport,
  PlatformError,
  FileSystem.FileSystem | Gemini | Processor | VectorStore
> =>
  Effect.gen(function* () {
    const candidates: Array<string> = []
    const skipped: Array<{ path: string; reason: string }> = []

    for (const path of paths) {
      const files = yield* collectFiles(path).pipe(Effect.either)
      if (Either.isLeft(files)) {
        skipped.push({ path, reason: String(files.left) })
      } else {
        candidates.push(...files.right)
      }
    }

    const supported: Array<string> = []
    for (const file of candidates) {
      const media = yield* detectMedia(file).pipe(Effect.either)
      if (Either.isLeft(media)) skipped.push({ path: file, reason: media.left.detail })
      else supported.push(file)
    }

    const outcomes = yield* Effect.forEach(
      supported,
      (file) => ingestPath(file).pipe(Effect.either),
      { concurrency: 4 }
    )

    const results: Array<IngestResult> = []
    outcomes.forEach((outcome, i) => {
      const file = supported[i] ?? "unknown"
      if (Either.isLeft(outcome)) skipped.push({ path: file, reason: String(outcome.left) })
      else results.push(outcome.right)
    })

    return { results, skipped }
  })

/** Embed the query and return the k nearest chunks. */
export const search = (
  query: string,
  k: number
): Effect.Effect<ReadonlyArray<SearchHit>, GeminiError | VectorStoreError, Gemini | VectorStore> =>
  Effect.gen(function* () {
    const gemini = yield* Gemini
    const store = yield* VectorStore
    const vectors = yield* gemini.embed([query], "RETRIEVAL_QUERY")
    return yield* store.search(vectors[0] ?? [], k)
  })
