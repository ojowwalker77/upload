import { Effect, Layer, Option, Ref } from "effect"
import { DEFAULT_CORPUS_ID, VectorStoreError } from "../domain.js"
import type {
  DocumentDescriptor,
  DocumentWriteStatus,
  EmbeddedChunk,
  SearchFilter,
  SearchHit,
  StoredDocument
} from "../domain.js"
import { VectorStore } from "../services/VectorStore.js"
import type { StoreMeta } from "../services/VectorStore.js"

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}

/** The pipeline stamps this on every chunk it embeds. */
export const metaOfChunk = (chunk: EmbeddedChunk): StoreMeta => ({
  model: chunk.metadata["embeddingModel"] ?? "unknown",
  dim: chunk.embedding.length
})

interface MemoryState {
  readonly chunks: ReadonlyMap<string, EmbeddedChunk>
  readonly documents: ReadonlyMap<string, StoredDocument>
  readonly meta: Option.Option<StoreMeta>
}

const matchesFilter = (
  chunk: EmbeddedChunk,
  documents: ReadonlyMap<string, StoredDocument>,
  filter?: SearchFilter
): boolean => {
  if (filter === undefined) return true
  if (filter.documentIds !== undefined && !filter.documentIds.includes(chunk.documentId)) {
    return false
  }
  if (filter.corpusId !== undefined) {
    const corpusId = documents.get(chunk.documentId)?.corpusId ??
      chunk.metadata["corpusId"] ?? DEFAULT_CORPUS_ID
    if (corpusId !== filter.corpusId) return false
  }
  return true
}

const validateDocumentChunks = (
  document: DocumentDescriptor,
  chunks: ReadonlyArray<EmbeddedChunk>
): Effect.Effect<void, VectorStoreError> => {
  for (const chunk of chunks) {
    if (chunk.documentId !== document.id) {
      return Effect.fail(
        new VectorStoreError({
          operation: "upsert",
          detail: `chunk ${chunk.id} belongs to ${chunk.documentId}, expected ${document.id}`
        })
      )
    }
    const chunkMeta = metaOfChunk(chunk)
    if (chunkMeta.model !== document.embeddingModel || chunkMeta.dim !== document.embeddingDim) {
      return Effect.fail(
        new VectorStoreError({
          operation: "upsert",
          detail: `chunk ${chunk.id} uses ${chunkMeta.model}/${chunkMeta.dim}, expected ${document.embeddingModel}/${document.embeddingDim}`
        })
      )
    }
  }
  return Effect.void
}

const inferredDocument = (chunks: ReadonlyArray<EmbeddedChunk>): DocumentDescriptor | undefined => {
  const first = chunks[0]
  if (first === undefined) return undefined
  const meta = metaOfChunk(first)
  return {
    id: first.documentId,
    corpusId: first.metadata["corpusId"] ?? DEFAULT_CORPUS_ID,
    sourceType: first.metadata["sourceType"] ?? "legacy",
    sourceId: first.metadata["sourceId"] ?? first.sourcePath,
    sourcePath: first.sourcePath,
    kind: first.kind,
    title: first.metadata["title"] ?? first.sourcePath,
    sourceUrl: first.metadata["sourceUrl"] ?? null,
    contentHash: first.metadata["contentHash"] ?? first.documentId,
    embeddingModel: meta.model,
    embeddingDim: meta.dim,
    metadata: {}
  }
}

/** In-memory store — per-process, mainly for tests and library embedding. */
export const MemoryVectorStoreLive: Layer.Layer<VectorStore> = Layer.effect(
  VectorStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make<MemoryState>({
      chunks: new Map(),
      documents: new Map(),
      meta: Option.none()
    })

    const replaceDocument = (
      document: DocumentDescriptor,
      chunks: ReadonlyArray<EmbeddedChunk>
    ): Effect.Effect<DocumentWriteStatus, VectorStoreError> =>
      Effect.gen(function* () {
        yield* validateDocumentChunks(document, chunks)
        const state = yield* Ref.get(ref)
        if (
          Option.isSome(state.meta) &&
          (state.meta.value.model !== document.embeddingModel ||
            state.meta.value.dim !== document.embeddingDim)
        ) {
          return yield* Effect.fail(
            new VectorStoreError({
              operation: "upsert",
              detail: `store uses ${state.meta.value.model}/${state.meta.value.dim}, incoming document uses ${document.embeddingModel}/${document.embeddingDim} — re-ingest or switch embedder`
            })
          )
        }

        const existing = state.documents.get(document.id)
        const now = new Date().toISOString()
        const stored: StoredDocument = {
          ...document,
          chunkCount: chunks.length,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        }
        const nextChunks = new Map(state.chunks)
        for (const [id, chunk] of nextChunks) {
          if (chunk.documentId === document.id) nextChunks.delete(id)
        }
        for (const chunk of chunks) nextChunks.set(chunk.id, chunk)
        const nextDocuments = new Map(state.documents)
        nextDocuments.set(document.id, stored)
        yield* Ref.set(ref, {
          chunks: nextChunks,
          documents: nextDocuments,
          meta: Option.some({ model: document.embeddingModel, dim: document.embeddingDim })
        })
        return existing === undefined ? "inserted" : "updated"
      })

    return VectorStore.of({
      upsert: (chunks) =>
        Effect.gen(function* () {
          const groups = new Map<string, Array<EmbeddedChunk>>()
          for (const chunk of chunks) {
            const group = groups.get(chunk.documentId) ?? []
            group.push(chunk)
            groups.set(chunk.documentId, group)
          }
          for (const group of groups.values()) {
            const document = inferredDocument(group)
            if (document !== undefined) yield* replaceDocument(document, group)
          }
        }),

      replaceDocument,

      search: (embedding, k, filter) =>
        Ref.get(ref).pipe(
          Effect.map((state) => {
            const hits: Array<SearchHit> = []
            for (const chunk of state.chunks.values()) {
              if (!matchesFilter(chunk, state.documents, filter)) continue
              hits.push({ chunk, score: cosine(embedding, chunk.embedding) })
            }
            hits.sort((a, b) => b.score - a.score)
            return hits.slice(0, Math.max(0, k))
          })
        ),

      count: (filter) =>
        Ref.get(ref).pipe(
          Effect.map((state) => {
            let count = 0
            for (const chunk of state.chunks.values()) {
              if (matchesFilter(chunk, state.documents, filter)) count += 1
            }
            return count
          })
        ),

      getDocument: (documentId) =>
        Ref.get(ref).pipe(
          Effect.map((state) => Option.fromNullable(state.documents.get(documentId)))
        ),

      listDocuments: (corpusId) =>
        Ref.get(ref).pipe(
          Effect.map((state) =>
            [...state.documents.values()]
              .filter((document) => document.corpusId === corpusId)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          )
        ),

      deleteDocument: (documentId) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(ref)
          if (!state.documents.has(documentId)) return false
          const chunks = new Map(state.chunks)
          for (const [id, chunk] of chunks) {
            if (chunk.documentId === documentId) chunks.delete(id)
          }
          const documents = new Map(state.documents)
          documents.delete(documentId)
          yield* Ref.set(ref, {
            chunks,
            documents,
            meta: chunks.size === 0 ? Option.none() : state.meta
          })
          return true
        }),

      meta: Ref.get(ref).pipe(Effect.map((state) => state.meta))
    })
  })
)
