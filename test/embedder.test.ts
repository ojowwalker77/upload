import { NodeHttpClient } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { describe, expect } from "vitest"
import type { EmbeddedChunk } from "../src/domain.js"
import { Embedder } from "../src/services/Embedder.js"
import { EmbedderMock } from "../src/services/EmbedderMock.js"
import { EmbedderOllamaLive } from "../src/services/EmbedderOllama.js"
import { VectorStore } from "../src/services/VectorStore.js"
import { MemoryVectorStoreLive } from "../src/stores/memory.js"

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0)

describe("EmbedderMock", () => {
  it.effect("embeddings are deterministic and unit-norm", () =>
    Effect.gen(function* () {
      const embedder = yield* Embedder
      const [a] = yield* embedder.embed(["the quick brown fox"], "document")
      const [b] = yield* embedder.embed(["the quick brown fox"], "query")
      expect(a).toEqual(b)
      const norm = Math.sqrt((a ?? []).reduce((s, v) => s + v * v, 0))
      expect(norm).toBeCloseTo(1, 6)
      expect(embedder.info.dim).toBe(768)
    }).pipe(Effect.provide(EmbedderMock))
  )

  it.effect("shared vocabulary means higher cosine similarity", () =>
    Effect.gen(function* () {
      const embedder = yield* Embedder
      const [a, b, c] = yield* embedder.embed(
        ["cats and dogs playing", "dogs and cats sleeping", "quantum finance derivatives report"],
        "document"
      )
      expect(cosine(a ?? [], b ?? [])).toBeGreaterThan(cosine(a ?? [], c ?? []))
    }).pipe(Effect.provide(EmbedderMock))
  )
})

describe("vector-space guard", () => {
  const chunk = (id: string, model: string): EmbeddedChunk => ({
    id,
    documentId: id,
    sourcePath: `/x/${id}`,
    kind: "text",
    index: 0,
    text: id,
    metadata: { path: `/x/${id}`, mimeType: "text/plain", embeddingModel: model },
    embedding: [1, 0, 0]
  })

  it.effect("store refuses chunks from a different embedding model", () =>
    Effect.gen(function* () {
      const store = yield* VectorStore
      yield* store.upsert([chunk("a", "model-one")])
      const result = yield* store.upsert([chunk("b", "model-two")]).pipe(Effect.either)
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left.detail).toContain("model-one")
        expect(result.left.detail).toContain("model-two")
      }
    }).pipe(Effect.provide(MemoryVectorStoreLive))
  )
})

// Live integration — runs only when a local Ollama with embeddinggemma is up.
const ollamaUp = await fetch("http://127.0.0.1:11434/api/tags")
  .then((r) => r.ok)
  .catch(() => false)

describe.skipIf(!ollamaUp)("EmbedderOllama (live local model)", () => {
  const OllamaLayer = EmbedderOllamaLive.pipe(Layer.provide(NodeHttpClient.layer))

  it.effect("returns unit-norm 768-dim vectors with real semantics", () =>
    Effect.gen(function* () {
      const embedder = yield* Embedder
      const [espresso, coffee, orbit] = yield* embedder.embed(
        [
          "pulling a great espresso shot with fine grind",
          "brewing strong coffee at the right temperature",
          "orbital mechanics and rocket staging"
        ],
        "document"
      )
      expect(espresso?.length).toBe(768)
      const norm = Math.sqrt((espresso ?? []).reduce((s, v) => s + v * v, 0))
      expect(norm).toBeCloseTo(1, 4)
      // real semantics: coffee topics must be closer than rockets
      expect(cosine(espresso ?? [], coffee ?? [])).toBeGreaterThan(
        cosine(espresso ?? [], orbit ?? [])
      )
    }).pipe(Effect.provide(OllamaLayer))
  )
})
