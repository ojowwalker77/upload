import { Context } from "effect"
import type { Effect, Option } from "effect"
import type { EmbeddedChunk, SearchHit, VectorStoreError } from "../domain.js"

/** The vector space a store's contents were embedded in. */
export interface StoreMeta {
  readonly model: string
  readonly dim: number
}

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

  /**
   * The embedding model + dims this store was populated with (none if empty).
   * The pipeline refuses to search a store with a different embedder —
   * same-dim vectors from different models are silent garbage otherwise.
   */
  readonly meta: Effect.Effect<Option.Option<StoreMeta>, VectorStoreError>
}

export class VectorStore extends Context.Tag("upload-world/VectorStore")<
  VectorStore,
  VectorStoreService
>() {}
