import { HttpClient } from "@effect/platform"
import { Effect, Layer, Redacted } from "effect"
import type { ConfigError } from "effect/ConfigError"
import { EmbeddingDim, EmbeddingModel, GeminiApiKey } from "../config.js"
import { EmbedderError } from "../domain.js"
import { Embedder } from "./Embedder.js"
import { geminiPost, l2Normalize } from "./geminiRest.js"

const EMBED_BATCH = 100

interface BatchEmbedResponse {
  readonly embeddings?: ReadonlyArray<{ readonly values?: ReadonlyArray<number> }>
}

/**
 * Gemini embeddings over REST. Handles both generations:
 * gemini-embedding-2 has no taskType param (query intent is a prompt prefix),
 * gemini-embedding-001 uses taskType RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY.
 */
export const EmbedderGeminiLive: Layer.Layer<Embedder, ConfigError, HttpClient.HttpClient> =
  Layer.effect(
    Embedder,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const apiKey = Redacted.value(yield* GeminiApiKey)
      const model = yield* EmbeddingModel
      const dim = yield* EmbeddingDim
      const isEmbedding2 = model.startsWith("gemini-embedding-2")

      const prepare = (text: string, intent: "document" | "query"): string =>
        isEmbedding2 && intent === "query" ? `task: search result | query: ${text}` : text

      return Embedder.of({
        info: { model, dim },
        embed: (texts, intent) =>
          Effect.gen(function* () {
            const out: Array<ReadonlyArray<number>> = []
            for (let i = 0; i < texts.length; i += EMBED_BATCH) {
              const batch = texts.slice(i, i + EMBED_BATCH)
              const json = yield* geminiPost(
                client,
                apiKey,
                "embed",
                `/models/${model}:batchEmbedContents`,
                {
                  requests: batch.map((text) => ({
                    model: `models/${model}`,
                    content: { parts: [{ text: prepare(text, intent) }] },
                    ...(isEmbedding2
                      ? {}
                      : { taskType: intent === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" }),
                    outputDimensionality: dim
                  }))
                }
              )
              const embeddings = (json as BatchEmbedResponse).embeddings
              if (embeddings === undefined || embeddings.length !== batch.length) {
                return yield* Effect.fail(
                  new EmbedderError({
                    model,
                    detail: `expected ${batch.length} embeddings, got ${embeddings?.length ?? 0}`
                  })
                )
              }
              for (const e of embeddings) {
                if (e.values === undefined || e.values.length === 0) {
                  return yield* Effect.fail(
                    new EmbedderError({ model, detail: "embedding with no values in response" })
                  )
                }
                out.push(l2Normalize(e.values))
              }
            }
            return out
          }).pipe(
            Effect.catchTag("GeminiError", (e) =>
              Effect.fail(new EmbedderError({ model, detail: `${e.operation}: ${e.detail}`, cause: e }))
            )
          )
      })
    })
  )
