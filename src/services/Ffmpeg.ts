import { Context } from "effect"
import type { Effect, Option } from "effect"
import type { ProcessingError } from "../domain.js"

export interface MediaInput {
  /** Source path/filename — used for error reporting and input extension hints. */
  readonly path: string
  readonly data: Uint8Array
  readonly mimeType: string
}

export interface OptimizedMedia {
  readonly data: Uint8Array
  readonly mimeType: string
}

export interface ExtractedVideo {
  /** Scene-detected key frames, already downscaled and JPEG-encoded. */
  readonly frames: ReadonlyArray<Uint8Array>
  /** The audio track, normalized for speech models; none if the video is silent. */
  readonly audio: Option.Option<OptimizedMedia>
}

/**
 * The mandatory media-conditioning stage: every audio/image/video input passes
 * through here BEFORE any model sees bytes. Shrinks payloads, normalizes
 * formats (16 kHz mono WAV for speech, capped JPEG for vision), and splits
 * video into key frames + audio track.
 */
export interface FfmpegService {
  /** Downmix mono, resample 16 kHz, loudness-normalize → WAV (what Whisper wants). */
  readonly optimizeAudio: (input: MediaInput) => Effect.Effect<OptimizedMedia, ProcessingError>
  /** Downscale to ≤1568px, strip metadata, re-encode JPEG. */
  readonly optimizeImage: (input: MediaInput) => Effect.Effect<OptimizedMedia, ProcessingError>
  /** Scene-detected key frames (≤12, JPEG) + optimized audio track. */
  readonly extractVideo: (input: MediaInput) => Effect.Effect<ExtractedVideo, ProcessingError>
}

export class Ffmpeg extends Context.Tag("upload-world/Ffmpeg")<Ffmpeg, FfmpegService>() {}
