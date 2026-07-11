import { HttpClientRequest } from "@effect/platform"
import type { HttpClient } from "@effect/platform"
import { Effect, Schedule } from "effect"
import { GeminiError } from "../domain.js"

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

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

/** POST to the Generative Language API with auth, timeout, and transient retry. */
export const geminiPost = (
  client: HttpClient.HttpClient,
  apiKey: string,
  operation: GeminiError["operation"],
  path: string,
  body: unknown
): Effect.Effect<unknown, GeminiError> =>
  Effect.gen(function* () {
    const request = HttpClientRequest.post(`${GEMINI_BASE_URL}${path}`).pipe(
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

export const l2Normalize = (values: ReadonlyArray<number>): ReadonlyArray<number> => {
  let sum = 0
  for (const v of values) sum += v * v
  const norm = Math.sqrt(sum)
  return norm === 0 ? values : values.map((v) => v / norm)
}
