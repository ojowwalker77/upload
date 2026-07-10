import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Effect, Layer, Redacted, Schedule } from "effect"
import type { ConfigError } from "effect/ConfigError"
import { EmbeddingDim, EmbeddingModel, GeminiApiKey, GeminiModel } from "../config.js"
import { GeminiError } from "../domain.js"
import { Gemini } from "./Gemini.js"

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
const EMBED_BATCH = 100

interface GenerateContentResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{ readonly text?: string }>
    }
  }>
}

interface BatchEmbedResponse {
  readonly embeddings?: ReadonlyArray<{ readonly values?: ReadonlyArray<number> }>
}

const l2Normalize = (values: ReadonlyArray<number>): ReadonlyArray<number> => {
  let sum = 0
  for (const v of values) sum += v * v
  const norm = Math.sqrt(sum)
  return norm === 0 ? values : values.map((v) => v / norm)
}

const statusOf = (e: GeminiError): number => {
  const cause = e.cause
  return typeof cause === "object" && cause !== null && "status" in cause
    ? Number((cause as { status: unknown }).status)
    : 0
}

const isTransient = (e: GeminiError): boolean => {
  const status = statusOf(e)
  return status === 429 || status >= 500
}

const retryPolicy = {
  times: 3,
  schedule: Schedule.exponential("500 millis"),
  while: isTransient
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
    const embeddingModel = yield* EmbeddingModel
    const embeddingDim = yield* EmbeddingDim

    const post = (
      operation: GeminiError["operation"],
      path: string,
      body: unknown
    ): Effect.Effect<unknown, GeminiError> =>
      Effect.gen(function* () {
        const request = HttpClientRequest.post(`${BASE_URL}${path}`).pipe(
          HttpClientRequest.setHeaders({ "x-goog-api-key": apiKey }),
          HttpClientRequest.bodyUnsafeJson(body)
        )
        const response = yield* client.execute(request).pipe(
          Effect.mapError(
            (cause) =>
              new GeminiError({
                operation,
                detail: `request failed: ${String(cause)}`,
                // network-level failures are worth retrying
                cause: { status: 599, cause }
              })
          )
        )
        if (response.status < 200 || response.status >= 300) {
          const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
          return yield* Effect.fail(
            new GeminiError({
              operation,
              detail: `HTTP ${response.status}: ${text.slice(0, 500)}`,
              cause: { status: response.status }
            })
          )
        }
        return yield* response.json.pipe(
          Effect.mapError(
            (cause) =>
              new GeminiError({ operation, detail: `invalid JSON response: ${String(cause)}`, cause })
          )
        )
      }).pipe(
        Effect.scoped,
        Effect.timeoutFail({
          duration: "120 seconds",
          onTimeout: () => new GeminiError({ operation, detail: "request timed out after 120s" })
        }),
        Effect.retry(retryPolicy)
      )

    const generateContent = (
      operation: GeminiError["operation"],
      parts: ReadonlyArray<unknown>
    ): Effect.Effect<string, GeminiError> =>
      post(operation, `/models/${model}:generateContent`, {
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
        ]),

      embed: (texts, taskType) =>
        Effect.gen(function* () {
          const out: Array<ReadonlyArray<number>> = []
          for (let i = 0; i < texts.length; i += EMBED_BATCH) {
            const batch = texts.slice(i, i + EMBED_BATCH)
            const json = yield* post("embed", `/models/${embeddingModel}:batchEmbedContents`, {
              requests: batch.map((text) => ({
                model: `models/${embeddingModel}`,
                content: { parts: [{ text }] },
                taskType,
                outputDimensionality: embeddingDim
              }))
            })
            const embeddings = (json as BatchEmbedResponse).embeddings
            if (embeddings === undefined || embeddings.length !== batch.length) {
              return yield* Effect.fail(
                new GeminiError({
                  operation: "embed",
                  detail: `expected ${batch.length} embeddings, got ${embeddings?.length ?? 0}`
                })
              )
            }
            for (const e of embeddings) {
              if (e.values === undefined || e.values.length === 0) {
                return yield* Effect.fail(
                  new GeminiError({ operation: "embed", detail: "embedding with no values in response" })
                )
              }
              out.push(l2Normalize(e.values))
            }
          }
          return out
        })
    })
  })
)
