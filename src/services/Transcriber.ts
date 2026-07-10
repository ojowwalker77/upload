import { Context } from "effect"
import type { Effect } from "effect"
import type { GeminiError, ProcessingError } from "../domain.js"
import type { MediaInput } from "./Ffmpeg.js"

/**
 * Speech-to-text seam. Input is expected to be ffmpeg-conditioned audio
 * (16 kHz mono WAV) — the Processor guarantees that.
 *
 * Implementations: WhisperCppLive (local whisper.cpp binary),
 * TranscriberOpenAILive (Whisper API), TranscriberGeminiLive (Gemini native).
 */
export interface TranscriberService {
  readonly transcribe: (input: MediaInput) => Effect.Effect<string, ProcessingError | GeminiError>
}

export class Transcriber extends Context.Tag("upload-world/Transcriber")<
  Transcriber,
  TranscriberService
>() {}
