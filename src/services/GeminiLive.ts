import { HttpClient } from "@effect/platform"
import { Effect, Layer, Redacted } from "effect"
import type { ConfigError } from "effect/ConfigError"
import { GeminiApiKey, GeminiModel } from "../config.js"
import { GeminiError } from "../domain.js"
import { Gemini } from "./Gemini.js"
import { geminiPost } from "./geminiRest.js"

interface GenerateContentResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{ readonly text?: string }>
    }
  }>
}

/**
 * Live Gemini client over the Generative Language REST API.
 * Requires an `HttpClient` (e.g. `NodeHttpClient.layer`) and `GEMINI_API_KEY`.
 */
export const GeminiLive: Layer.Layer<Gemini, ConfigError, HttpClient.HttpClient> = Layer.effect(
  Gemini,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const apiKey = Redacted.value(yield* GeminiApiKey)
    const model = yield* GeminiModel

    const generateContent = (
      operation: GeminiError["operation"],
      parts: ReadonlyArray<unknown>
    ): Effect.Effect<string, GeminiError> =>
      geminiPost(client, apiKey, operation, `/models/${model}:generateContent`, {
        contents: [{ parts }]
      }).pipe(
        Effect.flatMap((json) => {
          const text = (json as GenerateContentResponse).candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? "")
            .join("")
          return text !== undefined && text.length > 0
            ? Effect.succeed(text)
            : Effect.fail(
                new GeminiError({
                  operation,
                  detail: `no text in response: ${JSON.stringify(json).slice(0, 500)}`
                })
              )
        })
      )

    return Gemini.of({
      generateText: (prompt) => generateContent("generate", [{ text: prompt }]),

      describeMedia: ({ data, mimeType, prompt }) =>
        generateContent("describeMedia", [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: Buffer.from(data).toString("base64") } }
        ])
    })
  })
)
