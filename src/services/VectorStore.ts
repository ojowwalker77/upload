import { Context } from "effect"
import type { Effect, Option } from "effect"
import type {
  DocumentDescriptor,
  DocumentWriteStatus,
  EmbeddedChunk,
  SearchFilter,
  SearchHit,
  StoredDocument,
  VectorStoreError
} from "../domain.js"

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
  /**
   * Legacy low-level chunk write. New ingestion code should use
   * `replaceDocument`, which also persists identity and lifecycle state.
   */
  readonly upsert: (
    chunks: ReadonlyArray<EmbeddedChunk>
  ) => Effect.Effect<void, VectorStoreError>

  /** Atomically replace a document record and every chunk belonging to it. */
  readonly replaceDocument: (
    document: DocumentDescriptor,
    chunks: ReadonlyArray<EmbeddedChunk>
  ) => Effect.Effect<DocumentWriteStatus, VectorStoreError>

  /** k-nearest neighbours by cosine similarity. */
  readonly search: (
    embedding: ReadonlyArray<number>,
    k: number,
    filter?: SearchFilter
  ) => Effect.Effect<ReadonlyArray<SearchHit>, VectorStoreError>

  /** Number of stored chunks (for `status` / sanity checks). */
  readonly count: (
    filter?: SearchFilter
  ) => Effect.Effect<number, VectorStoreError>

  /** Retrieve one document by stable id. */
  readonly getDocument: (
    documentId: string
  ) => Effect.Effect<Option.Option<StoredDocument>, VectorStoreError>

  /** List document lifecycle state for one corpus. */
  readonly listDocuments: (
    corpusId: string
  ) => Effect.Effect<ReadonlyArray<StoredDocument>, VectorStoreError>

  /** Delete a document and all of its chunks. Returns whether it existed. */
  readonly deleteDocument: (
    documentId: string
  ) => Effect.Effect<boolean, VectorStoreError>

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
