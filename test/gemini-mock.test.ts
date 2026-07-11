import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { Gemini } from "../src/services/Gemini.js"
import { GeminiMock } from "../src/services/GeminiMock.js"

describe("GeminiMock", () => {
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

  it.effect("generateText is deterministic", () =>
    Effect.gen(function* () {
      const gemini = yield* Gemini
      const a = yield* gemini.generateText("summarize this")
      const b = yield* gemini.generateText("summarize this")
      expect(a).toBe(b)
      expect(a).toContain("[mock summary]")
    }).pipe(Effect.provide(GeminiMock))
  )
})
