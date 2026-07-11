import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Config, Effect, Layer } from "effect"
import { EmbedderError } from "../domain.js"
import { Embedder } from "./Embedder.js"
import { l2Normalize } from "./geminiRest.js"

export const OllamaBaseUrl = Config.string("UPLOAD_WORLD_OLLAMA_URL").pipe(
  Config.withDefault("http://127.0.0.1:11434")
)

export const OllamaEmbedModel = Config.string("UPLOAD_WORLD_OLLAMA_EMBED_MODEL").pipe(
  Config.withDefault("embeddinggemma")
)

const EMBED_BATCH = 64

interface OllamaEmbedResponse {
  readonly embeddings?: ReadonlyArray<ReadonlyArray<number>>
}

/**
 * 100% local embeddings via Ollama (default model: EmbeddingGemma-300m,
 * 768 dims — Gemini-family quality with no API key and no bytes leaving
 * the machine). `brew install ollama && ollama pull embeddinggemma`.
 *
 * EmbeddingGemma is prompt-instructed: documents and queries get the
 * prefixes from its model card.
 */
export const EmbedderOllamaLive: Layer.Layer<Embedder, never, HttpClient.HttpClient> =
  Layer.effect(
    Embedder,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const baseUrl = yield* OllamaBaseUrl.pipe(Effect.orDie)
      const model = yield* OllamaEmbedModel.pipe(Effect.orDie)

      const prepare = (text: string, intent: "document" | "query"): string =>
        intent === "query" ? `task: search result | query: ${text}` : `title: none | text: ${text}`

      const embedBatch = (
        texts: ReadonlyArray<string>
      ): Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, EmbedderError> =>
        Effect.gen(function* () {
          const request = HttpClientRequest.post(`${baseUrl}/api/embed`).pipe(
            HttpClientRequest.bodyUnsafeJson({ model, input: texts })
          )
          const response = yield* client.execute(request).pipe(
            Effect.mapError(
              (cause) =>
                new EmbedderError({
                  model,
                  detail: `Ollama unreachable at ${baseUrl} — is it running? (ollama serve) (${String(cause)})`,
                  cause
                })
            )
          )
          const text = yield* response.text.pipe(
            Effect.mapError(
              (cause) => new EmbedderError({ model, detail: `unreadable Ollama response: ${String(cause)}`, cause })
            )
          )
          if (response.status < 200 || response.status >= 300) {
            const hint = response.status === 404 ? ` — try: ollama pull ${model}` : ""
            return yield* Effect.fail(
              new EmbedderError({ model, detail: `Ollama HTTP ${response.status}: ${text.slice(0, 300)}${hint}` })
            )
          }
          const embeddings = (JSON.parse(text) as OllamaEmbedResponse).embeddings
          if (embeddings === undefined || embeddings.length !== texts.length) {
            return yield* Effect.fail(
              new EmbedderError({
                model,
                detail: `expected ${texts.length} embeddings, got ${embeddings?.length ?? 0}`
              })
            )
          }
          return embeddings.map(l2Normalize)
        }).pipe(
          Effect.scoped,
          Effect.timeoutFail({
            duration: "120 seconds",
            onTimeout: () => new EmbedderError({ model, detail: "Ollama embed timed out after 120s" })
          })
        )

      return Embedder.of({
        // EmbeddingGemma emits 768-dim MRL vectors — same shape as our Gemini default
        info: { model: `ollama/${model}`, dim: 768 },
        embed: (texts, intent) =>
          Effect.gen(function* () {
            const out: Array<ReadonlyArray<number>> = []
            for (let i = 0; i < texts.length; i += EMBED_BATCH) {
              out.push(...(yield* embedBatch(texts.slice(i, i + EMBED_BATCH).map((t) => prepare(t, intent)))))
            }
            return out
          })
      })
    })
  )
