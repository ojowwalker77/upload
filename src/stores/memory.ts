import { Effect, Layer, Ref } from "effect"
import type { EmbeddedChunk, SearchHit } from "../domain.js"
import { VectorStore } from "../services/VectorStore.js"

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

/** In-memory store — per-process, mainly for tests and library embedding. */
export const MemoryVectorStoreLive: Layer.Layer<VectorStore> = Layer.effect(
  VectorStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make(new Map<string, EmbeddedChunk>())

    return VectorStore.of({
      upsert: (chunks) =>
        Ref.update(ref, (map) => {
          const next = new Map(map)
          for (const chunk of chunks) next.set(chunk.id, chunk)
          return next
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

      count: Ref.get(ref).pipe(Effect.map((map) => map.size))
    })
  })
)
