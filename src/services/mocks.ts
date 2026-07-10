import { Effect, Layer, Option } from "effect"
import { Ffmpeg } from "./Ffmpeg.js"
import { Transcriber } from "./Transcriber.js"

/**
 * Deterministic ffmpeg stand-in for tests and environments without the
 * binary: passes bytes through untouched, "extracts" the video itself as a
 * single frame with no audio track.
 */
export const FfmpegMock: Layer.Layer<Ffmpeg> = Layer.succeed(
  Ffmpeg,
  Ffmpeg.of({
    optimizeAudio: (input) => Effect.succeed({ data: input.data, mimeType: "audio/wav" }),
    optimizeImage: (input) => Effect.succeed({ data: input.data, mimeType: "image/jpeg" }),
    extractVideo: (input) => Effect.succeed({ frames: [input.data], audio: Option.none() })
  })
)

/** Deterministic transcript embedding the filename and byte length. */
export const TranscriberMock: Layer.Layer<Transcriber> = Layer.succeed(
  Transcriber,
  Transcriber.of({
    transcribe: (input) =>
      Effect.succeed(`[mock transcript of ${input.path}, ${input.data.byteLength} bytes]`)
  })
)
