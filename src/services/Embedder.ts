import { Context } from "effect"
import type { Effect } from "effect"
import type { EmbedderError } from "../domain.js"

/**
 * The Embed seam — its own capability, independent of the Gemini provider,
 * so embeddings can run 100% local (Ollama/EmbeddingGemma) while vision
 * stays on Gemini, or any other mix.
 */
export interface EmbedderService {
  /** Identifies the vector space. Stores record this and refuse mixed spaces. */
  readonly info: { readonly model: string; readonly dim: number }

  /**
   * Batch-embed texts. `intent` distinguishes retrieval documents from
   * queries — providers map it to task types or prompt prefixes as needed.
   * Implementations batch internally; pass any number of texts.
   */
  readonly embed: (
    texts: ReadonlyArray<string>,
    intent: "document" | "query"
  ) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, EmbedderError>
}

export class Embedder extends Context.Tag("upload-world/Embedder")<Embedder, EmbedderService>() {}
