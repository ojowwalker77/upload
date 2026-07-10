import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { Gemini } from "../src/services/Gemini.js"
import { GeminiMock } from "../src/services/GeminiMock.js"

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0)

describe("GeminiMock", () => {
  it.effect("embeddings are deterministic and unit-norm", () =>
    Effect.gen(function* () {
      const gemini = yield* Gemini
      const [a] = yield* gemini.embed(["the quick brown fox"], "RETRIEVAL_DOCUMENT")
      const [b] = yield* gemini.embed(["the quick brown fox"], "RETRIEVAL_QUERY")
      expect(a).toEqual(b)
      const norm = Math.sqrt((a ?? []).reduce((s, v) => s + v * v, 0))
      expect(norm).toBeCloseTo(1, 6)
    }).pipe(Effect.provide(GeminiMock))
  )

  it.effect("shared vocabulary means higher cosine similarity", () =>
    Effect.gen(function* () {
      const gemini = yield* Gemini
      const [a, b, c] = yield* gemini.embed(
        ["cats and dogs playing", "dogs and cats sleeping", "quantum finance derivatives report"],
        "RETRIEVAL_DOCUMENT"
      )
      const near = cosine(a ?? [], b ?? [])
      const far = cosine(a ?? [], c ?? [])
      expect(near).toBeGreaterThan(far)
    }).pipe(Effect.provide(GeminiMock))
  )

  it.effect("describeMedia mentions mime type and byte length", () =>
    Effect.gen(function* () {
      const gemini = yield* Gemini
      const text = yield* gemini.describeMedia({
        mimeType: "audio/mpeg",
        data: new Uint8Array(1234),
        prompt: "Transcribe this audio"
      })
      expect(text).toContain("audio/mpeg")
      expect(text).toContain("1234")
    }).pipe(Effect.provide(GeminiMock))
  )
})
