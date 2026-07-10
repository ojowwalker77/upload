import { Effect, Layer } from "effect"
import { Gemini } from "./Gemini.js"

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
 * Bag-of-words hash projection: each word contributes a deterministic unit
 * vector, so identical texts embed identically and texts sharing vocabulary
 * land closer in cosine space. Good enough to exercise the full pipeline
 * (ingest → store → search) offline.
 */
const mockEmbed = (text: string): ReadonlyArray<number> => {
  const accumulator = new Float64Array(DIM)
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0)
  for (const word of words) {
    const next = prng(fnv1a(word))
    for (let i = 0; i < DIM; i++) accumulator[i] = (accumulator[i] ?? 0) + (next() * 2 - 1)
  }
  return l2Normalize(accumulator)
}

/** Deterministic, offline Gemini — for tests and keyless runs. */
export const GeminiMock: Layer.Layer<Gemini> = Layer.succeed(
  Gemini,
  Gemini.of({
    generateText: (prompt) => Effect.succeed(`[mock summary] ${prompt.slice(0, 200)}`),

    describeMedia: ({ data, mimeType, prompt }) =>
      Effect.succeed(
        `[mock description of ${mimeType}, ${data.byteLength} bytes] ` +
          `Deterministic offline stand-in for Gemini media understanding. Prompt was: ${prompt.slice(0, 120)}`
      ),

    embed: (texts, _taskType) => Effect.succeed(texts.map(mockEmbed))
  })
)
