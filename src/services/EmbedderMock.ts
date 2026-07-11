import { Effect, Layer } from "effect"
import { Embedder } from "./Embedder.js"

const DIM = 768

const fnv1a = (input: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32 — tiny deterministic PRNG. */
const prng = (seed: number): (() => number) => {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const l2Normalize = (vector: Float64Array): ReadonlyArray<number> => {
  let sum = 0
  for (const v of vector) sum += v * v
  const norm = Math.sqrt(sum)
  return Array.from(vector, (v) => (norm === 0 ? 0 : v / norm))
}

/**
 * Bag-of-words hash projection: identical texts embed identically and texts
 * sharing vocabulary land closer in cosine space. Good enough to exercise
 * the full pipeline offline; useless for real semantics.
 */
export const mockEmbed = (text: string): ReadonlyArray<number> => {
  const accumulator = new Float64Array(DIM)
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0)
  for (const word of words) {
    const next = prng(fnv1a(word))
    for (let i = 0; i < DIM; i++) accumulator[i] = (accumulator[i] ?? 0) + (next() * 2 - 1)
  }
  return l2Normalize(accumulator)
}

/** Deterministic offline embedder — for tests and keyless demo runs. */
export const EmbedderMock: Layer.Layer<Embedder> = Layer.succeed(
  Embedder,
  Embedder.of({
    info: { model: "mock-bow", dim: DIM },
    embed: (texts, _intent) => Effect.succeed(texts.map(mockEmbed))
  })
)
