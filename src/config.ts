import { Config } from "effect"

export const GeminiApiKey = Config.redacted("GEMINI_API_KEY")

export const GeminiModel = Config.string("UPLOAD_WORLD_GEMINI_MODEL").pipe(
  Config.withDefault("gemini-2.5-flash")
)

export const EmbeddingModel = Config.string("UPLOAD_WORLD_EMBEDDING_MODEL").pipe(
  Config.withDefault("gemini-embedding-001")
)

/** Output dimensionality requested from the embedding model (MRL-truncated). */
export const EmbeddingDim = Config.integer("UPLOAD_WORLD_EMBEDDING_DIM").pipe(
  Config.withDefault(768)
)
