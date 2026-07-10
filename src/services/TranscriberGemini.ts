import { Effect, Layer } from "effect"
import { Gemini } from "./Gemini.js"
import { Transcriber } from "./Transcriber.js"

/**
 * Gemini-native transcription — no extra binary or key beyond GEMINI_API_KEY.
 * Also the offline path: provided with GeminiMock it is fully deterministic.
 */
export const TranscriberGeminiLive: Layer.Layer<Transcriber, never, Gemini> = Layer.effect(
  Transcriber,
  Effect.gen(function* () {
    const gemini = yield* Gemini
    return Transcriber.of({
      transcribe: (input) =>
        gemini.describeMedia({
          mimeType: input.mimeType,
          data: input.data,
          prompt:
            "Transcribe this audio verbatim. Then add a one-paragraph summary prefixed with 'Summary:'."
        })
    })
  })
)
