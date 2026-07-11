import { Effect, Layer, Option, Ref } from "effect"
import { VectorStoreError } from "../domain.js"
import type { EmbeddedChunk, SearchHit } from "../domain.js"
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

/** In-memory store — per-process, mainly for tests and library embedding. */
export const MemoryVectorStoreLive: Layer.Layer<VectorStore> = Layer.effect(
  VectorStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make(new Map<string, EmbeddedChunk>())
    const metaRef = yield* Ref.make(Option.none<StoreMeta>())

    return VectorStore.of({
      upsert: (chunks) =>
        Effect.gen(function* () {
          const first = chunks[0]
          if (first === undefined) return
          const incoming = metaOfChunk(first)
          const existing = yield* Ref.get(metaRef)
          if (Option.isSome(existing) && existing.value.model !== incoming.model) {
            return yield* Effect.fail(
              new VectorStoreError({
                operation: "upsert",
                detail: `store was embedded with "${existing.value.model}", incoming chunks use "${incoming.model}" — re-ingest or switch embedder`
              })
            )
          }
          yield* Ref.set(metaRef, Option.some(incoming))
          yield* Ref.update(ref, (map) => {
            const next = new Map(map)
            for (const chunk of chunks) next.set(chunk.id, chunk)
            return next
          })
        }),

      search: (embedding, k) =>
        Ref.get(ref).pipe(
          Effect.map((map) => {
            const hits: Array<SearchHit> = []
            for (const chunk of map.values()) {
              hits.push({ chunk, score: cosine(embedding, chunk.embedding) })
            }
            hits.sort((a, b) => b.score - a.score)
            return hits.slice(0, Math.max(0, k))
          })
        ),

      count: Ref.get(ref).pipe(Effect.map((map) => map.size)),

      meta: Ref.get(metaRef)
    })
  })
)
