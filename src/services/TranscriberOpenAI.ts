import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Effect, Layer, Redacted } from "effect"
import { OpenAIApiKey, OpenAITranscribeModel } from "../config.js"
import { ProcessingError } from "../domain.js"
import { Transcriber } from "./Transcriber.js"

/** OpenAI Whisper API — requires OPENAI_API_KEY. */
export const TranscriberOpenAILive: Layer.Layer<
  Transcriber,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  Transcriber,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    return Transcriber.of({
      transcribe: (input) =>
        Effect.gen(function* () {
          const apiKey = yield* OpenAIApiKey.pipe(
            Effect.mapError(
              () =>
                new ProcessingError({
                  path: input.path,
                  detail: "OPENAI_API_KEY is not set (required for the OpenAI Whisper transcriber)"
                })
            )
          )
          const model = yield* OpenAITranscribeModel.pipe(Effect.orDie)

          const form = new FormData()
          form.append("model", model)
          form.append("response_format", "text")
          form.append("file", new File([Buffer.from(input.data)], "audio.wav", { type: input.mimeType }))

          const request = HttpClientRequest.post("https://api.openai.com/v1/audio/transcriptions").pipe(
            HttpClientRequest.setHeaders({ authorization: `Bearer ${Redacted.value(apiKey)}` }),
            HttpClientRequest.bodyFormData(form)
          )
          const response = yield* client.execute(request).pipe(
            Effect.mapError(
              (cause) => new ProcessingError({ path: input.path, detail: `whisper API request failed: ${String(cause)}`, cause })
            )
          )
          const text = yield* response.text.pipe(
            Effect.mapError(
              (cause) => new ProcessingError({ path: input.path, detail: `whisper API response unreadable: ${String(cause)}`, cause })
            )
          )
          if (response.status < 200 || response.status >= 300) {
            return yield* Effect.fail(
              new ProcessingError({
                path: input.path,
                detail: `whisper API HTTP ${response.status}: ${text.slice(0, 500)}`
              })
            )
          }
          return text.trim()
        }).pipe(Effect.scoped)
    })
  })
)
