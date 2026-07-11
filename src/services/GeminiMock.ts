import { Effect, Layer } from "effect"
import { Gemini } from "./Gemini.js"

/** Deterministic, offline Gemini — for tests and keyless runs. */
export const GeminiMock: Layer.Layer<Gemini> = Layer.succeed(
  Gemini,
  Gemini.of({
    generateText: (prompt) => Effect.succeed(`[mock summary] ${prompt.slice(0, 200)}`),

    describeMedia: ({ data, mimeType, prompt }) =>
      Effect.succeed(
        `[mock description of ${mimeType}, ${data.byteLength} bytes] ` +
          `Deterministic offline stand-in for Gemini media understanding. Prompt was: ${prompt.slice(0, 120)}`
      )
  })
)
