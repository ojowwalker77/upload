import { Command, FileSystem, Path } from "@effect/platform"
import { CommandExecutor } from "@effect/platform/CommandExecutor"
import { Effect, Layer, Option, Stream } from "effect"
import { FfmpegBin } from "../config.js"
import { ProcessingError } from "../domain.js"
import { Ffmpeg } from "./Ffmpeg.js"
import type { MediaInput, OptimizedMedia } from "./Ffmpeg.js"

const MAX_FRAMES = 12
/** Anthropic/Gemini vision models see no benefit beyond ~1.5k px on the long edge. */
const IMAGE_MAX_EDGE = 1568
const FRAME_MAX_EDGE = 1024
const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"

const extensionFor = (input: MediaInput): string => {
  const dot = input.path.lastIndexOf(".")
  return dot === -1 ? "bin" : input.path.slice(dot + 1).toLowerCase()
}

/** Run a command, capturing stderr for diagnostics (ffmpeg logs everything there). */
const run = (
  bin: string,
  args: ReadonlyArray<string>,
  path: string
): Effect.Effect<void, ProcessingError, CommandExecutor> =>
  Effect.gen(function* () {
    const command = Command.make(bin, ...args).pipe(Command.stderr("pipe"))
    const process = yield* Command.start(command)
    const [stderrBytes, exitCode] = yield* Effect.all(
      [Stream.runCollect(process.stderr), process.exitCode],
      { concurrency: 2 }
    )
    if (exitCode !== 0) {
      const stderr = Buffer.concat([...stderrBytes].map((c) => Buffer.from(c))).toString("utf-8")
      return yield* Effect.fail(
        new ProcessingError({
          path,
          detail: `${bin} exited with ${exitCode}: ${stderr.slice(-800)}`
        })
      )
    }
  }).pipe(
    Effect.scoped,
    Effect.catchTag("BadArgument", "SystemError", (cause) =>
      Effect.fail(
        new ProcessingError({
          path,
          detail: `failed to spawn ${bin} — is it installed and on PATH? (${String(cause)})`,
          cause
        })
      )
    )
  )

/**
 * Real ffmpeg: shells out to the binary (config `UPLOAD_WORLD_FFMPEG_BIN`),
 * staging bytes through a scoped temp directory per operation.
 */
export const FfmpegLive: Layer.Layer<
  Ffmpeg,
  never,
  CommandExecutor | FileSystem.FileSystem | Path.Path
> = Layer.effect(
  Ffmpeg,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathMod = yield* Path.Path
    const executor = yield* CommandExecutor
    const bin = yield* FfmpegBin.pipe(Effect.orDie)
    const provideExec = Effect.provideService(CommandExecutor, executor)

    /** Stage input in a temp dir, run ffmpeg invocations against it, collect outputs. */
    const withTempDir = <A>(
      input: MediaInput,
      body: (dir: string, inFile: string) => Effect.Effect<A, ProcessingError, CommandExecutor>
    ): Effect.Effect<A, ProcessingError> =>
      Effect.gen(function* () {
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "upload-world-ffmpeg-" })
        const inFile = pathMod.join(dir, `in.${extensionFor(input)}`)
        yield* fs.writeFile(inFile, input.data)
        return yield* body(dir, inFile)
      }).pipe(
        provideExec,
        Effect.scoped,
        Effect.catchTag("BadArgument", "SystemError", (cause) =>
          Effect.fail(
            new ProcessingError({ path: input.path, detail: `temp staging failed: ${String(cause)}`, cause })
          )
        )
      )

    const readOut = (file: string, path: string): Effect.Effect<Uint8Array, ProcessingError> =>
      fs.readFile(file).pipe(
        Effect.mapError(
          (cause) => new ProcessingError({ path, detail: `ffmpeg produced no output: ${String(cause)}`, cause })
        )
      )

    const optimizeAudio = (input: MediaInput): Effect.Effect<OptimizedMedia, ProcessingError> =>
      withTempDir(input, (dir, inFile) =>
        Effect.gen(function* () {
          const outFile = pathMod.join(dir, "out.wav")
          yield* run(
            bin,
            ["-hide_banner", "-y", "-i", inFile, "-vn", "-ac", "1", "-ar", "16000", "-af", LOUDNORM, "-c:a", "pcm_s16le", outFile],
            input.path
          )
          const data = yield* readOut(outFile, input.path)
          return { data, mimeType: "audio/wav" }
        })
      )

    const optimizeImage = (input: MediaInput): Effect.Effect<OptimizedMedia, ProcessingError> =>
      withTempDir(input, (dir, inFile) =>
        Effect.gen(function* () {
          const outFile = pathMod.join(dir, "out.jpg")
          yield* run(
            bin,
            ["-hide_banner", "-y", "-i", inFile, "-vf", `scale='min(${IMAGE_MAX_EDGE},iw)':-2`, "-map_metadata", "-1", "-frames:v", "1", "-q:v", "3", outFile],
            input.path
          )
          const data = yield* readOut(outFile, input.path)
          return { data, mimeType: "image/jpeg" }
        })
      )

    const extractVideo = (input: MediaInput) =>
      withTempDir(input, (dir, inFile) =>
        Effect.gen(function* () {
          const framePattern = pathMod.join(dir, "frame-%03d.jpg")
          const scale = `scale='min(${FRAME_MAX_EDGE},iw)':-2`
          // scene-change detection, always including the first frame
          yield* run(
            bin,
            ["-hide_banner", "-y", "-i", inFile, "-vf", `select='eq(n\\,0)+gt(scene\\,0.30)',${scale}`, "-fps_mode", "vfr", "-frames:v", String(MAX_FRAMES), "-q:v", "3", framePattern],
            input.path
          )
          let frameFiles = (yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as Array<string>)))
            .filter((f) => f.startsWith("frame-"))
            .sort()
          // static footage produces no scene cuts — fall back to 1 fps sampling
          if (frameFiles.length <= 1) {
            yield* run(
              bin,
              ["-hide_banner", "-y", "-i", inFile, "-vf", `fps=1,${scale}`, "-frames:v", String(MAX_FRAMES), "-q:v", "3", framePattern],
              input.path
            )
            frameFiles = (yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as Array<string>)))
              .filter((f) => f.startsWith("frame-"))
              .sort()
          }
          const frames: Array<Uint8Array> = []
          for (const file of frameFiles.slice(0, MAX_FRAMES)) {
            frames.push(yield* readOut(pathMod.join(dir, file), input.path))
          }
          if (frames.length === 0) {
            return yield* Effect.fail(
              new ProcessingError({ path: input.path, detail: "ffmpeg extracted no frames from video" })
            )
          }

          // audio track is optional — silent/black videos are still describable
          const audioFile = pathMod.join(dir, "audio.wav")
          const audio = yield* run(
            bin,
            ["-hide_banner", "-y", "-i", inFile, "-vn", "-ac", "1", "-ar", "16000", "-af", LOUDNORM, "-c:a", "pcm_s16le", audioFile],
            input.path
          ).pipe(
            Effect.zipRight(readOut(audioFile, input.path)),
            Effect.map((data) => Option.some({ data, mimeType: "audio/wav" })),
            Effect.orElseSucceed(() => Option.none<OptimizedMedia>())
          )

          return { frames, audio }
        })
      )

    return Ffmpeg.of({ optimizeAudio, optimizeImage, extractVideo })
  })
)
