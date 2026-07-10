import { Context } from "effect"
import type { Effect } from "effect"
import type { EmbeddedChunk, SearchHit, VectorStoreError } from "../domain.js"

/**
 * The pluggable persistence seam. Users pick (or write) a destination:
 * in-memory, SQLite + sqlite-vec, pgvector, LanceDB, a SaaS — anything that
 * can satisfy this interface behind a Layer.
 */
export interface VectorStoreService {
  /** Insert or replace chunks by id. Replaces all chunks of a re-ingested document. */
  readonly upsert: (
    chunks: ReadonlyArray<EmbeddedChunk>
  ) => Effect.Effect<void, VectorStoreError>

  /** k-nearest neighbours by cosine similarity. */
  readonly search: (
    embedding: ReadonlyArray<number>,
    k: number
  ) => Effect.Effect<ReadonlyArray<SearchHit>, VectorStoreError>

  /** Number of stored chunks (for `status` / sanity checks). */
  readonly count: Effect.Effect<number, VectorStoreError>
}

export class VectorStore extends Context.Tag("upload-world/VectorStore")<
  VectorStore,
  VectorStoreService
>() {}
