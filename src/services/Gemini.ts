import { Context } from "effect"
import type { Effect } from "effect"
import type { GeminiError } from "../domain.js"

/**
 * The generative-understanding seam: describe/extract media, summarize text.
 * (Embeddings are their own seam — see Embedder.)
 *
 * Implementations: GeminiLive (REST via @effect/platform HttpClient) and
 * GeminiMock (deterministic, offline — for tests and keyless runs).
 */
export interface GeminiService {
  /** Text-in, text-out (summaries, descriptions of plain text). */
  readonly generateText: (prompt: string) => Effect.Effect<string, GeminiError>

  /** Media-in, text-out: transcript / description / extracted text. */
  readonly describeMedia: (input: {
    readonly mimeType: string
    readonly data: Uint8Array
    readonly prompt: string
  }) => Effect.Effect<string, GeminiError>
}

export class Gemini extends Context.Tag("upload-world/Gemini")<Gemini, GeminiService>() {}
