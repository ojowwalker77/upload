import { Data } from "effect"

// ─── Media routing ───────────────────────────────────────────────────────────

export type MediaKind = "text" | "audio" | "video" | "image" | "pdf" | "mix"

/** A single input handed to the pipeline. `data` is the raw file bytes. */
export interface IngestSource {
  readonly path: string
  readonly mimeType: string
  readonly kind: MediaKind
  readonly data: Uint8Array
}

// ─── Pipeline output ─────────────────────────────────────────────────────────

/**
 * Every modality is normalized to text chunks: plain text is chunked directly,
 * audio becomes a transcript, video/images become descriptions, PDFs become
 * extracted text/tables. Chunks are what get embedded and stored.
 */
export interface Chunk {
  readonly id: string
  readonly documentId: string
  readonly sourcePath: string
  readonly kind: MediaKind
  readonly index: number
  readonly text: string
  readonly metadata: Readonly<Record<string, string>>
}

export interface EmbeddedChunk extends Chunk {
  readonly embedding: ReadonlyArray<number>
}

export interface SearchHit {
  readonly chunk: EmbeddedChunk
  /** Cosine similarity in [-1, 1]; higher is closer. */
  readonly score: number
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class UnsupportedMediaError extends Data.TaggedError("UnsupportedMediaError")<{
  readonly path: string
  readonly detail: string
}> {}

export class GeminiError extends Data.TaggedError("GeminiError")<{
  readonly operation: "generate" | "describeMedia" | "embed"
  readonly detail: string
  readonly cause?: unknown
}> {}

export class ProcessingError extends Data.TaggedError("ProcessingError")<{
  readonly path: string
  readonly detail: string
  readonly cause?: unknown
}> {}

export class VectorStoreError extends Data.TaggedError("VectorStoreError")<{
  readonly operation: "upsert" | "search" | "init"
  readonly detail: string
  readonly cause?: unknown
}> {}
