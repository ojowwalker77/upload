import { Config } from "effect"

export const GeminiApiKey = Config.redacted("GEMINI_API_KEY")

export const GeminiModel = Config.string("UPLOAD_WORLD_GEMINI_MODEL").pipe(
  Config.withDefault("gemini-2.5-flash")
)

/**
 * Gemini Embedding 2 (March 2026): natively multimodal, auto-normalized,
 * no taskType param — retrieval intent goes into the prompt instead.
 * Set to gemini-embedding-001 to get the legacy taskType behavior.
 */
export const EmbeddingModel = Config.string("UPLOAD_WORLD_EMBEDDING_MODEL").pipe(
  Config.withDefault("gemini-embedding-2")
)

/** Output dimensionality requested from the embedding model (MRL-truncated). */
export const EmbeddingDim = Config.integer("UPLOAD_WORLD_EMBEDDING_DIM").pipe(
  Config.withDefault(768)
)

// ─── Media preprocessing (ffmpeg) & transcription (whisper) ──────────────────

export const FfmpegBin = Config.string("UPLOAD_WORLD_FFMPEG_BIN").pipe(
  Config.withDefault("ffmpeg")
)

export const WhisperBin = Config.string("UPLOAD_WORLD_WHISPER_BIN").pipe(
  Config.withDefault("whisper-cli")
)

/** ggml model name for whisper.cpp: tiny | base | small | medium | large-v3-turbo … */
export const WhisperModel = Config.string("UPLOAD_WORLD_WHISPER_MODEL").pipe(
  Config.withDefault("base")
)

/** Absolute path to a ggml model file; overrides the auto-download of WhisperModel. */
export const WhisperModelPath = Config.option(Config.string("UPLOAD_WORLD_WHISPER_MODEL_PATH"))

export const OpenAIApiKey = Config.redacted("OPENAI_API_KEY")

export const OpenAITranscribeModel = Config.string("UPLOAD_WORLD_OPENAI_TRANSCRIBE_MODEL").pipe(
  Config.withDefault("whisper-1")
)
