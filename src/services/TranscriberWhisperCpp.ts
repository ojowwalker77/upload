import { Command, FileSystem, Path } from "@effect/platform"
import { CommandExecutor } from "@effect/platform/CommandExecutor"
import { Effect, Layer, Option } from "effect"
import { homedir } from "node:os"
import { WhisperBin, WhisperModel, WhisperModelPath } from "../config.js"
import { ProcessingError } from "../domain.js"
import { Transcriber } from "./Transcriber.js"

const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

/**
 * Local whisper.cpp (`brew install whisper-cpp`). The ggml model is
 * auto-downloaded to ~/.cache/upload-world/models on first use
 * (override with UPLOAD_WORLD_WHISPER_MODEL_PATH).
 */
export const WhisperCppLive: Layer.Layer<
  Transcriber,
  never,
  CommandExecutor | FileSystem.FileSystem | Path.Path
> = Layer.effect(
  Transcriber,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathMod = yield* Path.Path
    const executor = yield* CommandExecutor
    const provideExec = Effect.provideService(CommandExecutor, executor)
    const bin = yield* WhisperBin.pipe(Effect.orDie)
    const model = yield* WhisperModel.pipe(Effect.orDie)
    const modelPathOverride = yield* WhisperModelPath.pipe(Effect.orDie)

    const defaultModelPath = pathMod.join(
      homedir(),
      ".cache",
      "upload-world",
      "models",
      `ggml-${model}.bin`
    )
    const modelPath = Option.getOrElse(modelPathOverride, () => defaultModelPath)

    const ensureModel = (sourcePath: string): Effect.Effect<void, ProcessingError, CommandExecutor> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(modelPath).pipe(Effect.orElseSucceed(() => false))
        if (exists) return
        if (Option.isSome(modelPathOverride)) {
          return yield* Effect.fail(
            new ProcessingError({
              path: sourcePath,
              detail: `whisper model not found at UPLOAD_WORLD_WHISPER_MODEL_PATH=${modelPath}`
            })
          )
        }
        yield* Effect.logInfo(`downloading whisper model ggml-${model}.bin to ${modelPath} …`)
        yield* fs
          .makeDirectory(pathMod.dirname(modelPath), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProcessingError({ path: sourcePath, detail: `cannot create model dir: ${String(cause)}`, cause })
            )
          )
        const partial = `${modelPath}.download`
        const curl = Command.make(
          "curl",
          "-L",
          "--fail",
          "--silent",
          "--show-error",
          "-o",
          partial,
          `${MODEL_BASE_URL}/ggml-${model}.bin`
        )
        const exitCode = yield* Command.exitCode(curl).pipe(
          Effect.mapError(
            (cause) => new ProcessingError({ path: sourcePath, detail: `model download failed: ${String(cause)}`, cause })
          )
        )
        if (exitCode !== 0) {
          return yield* Effect.fail(
            new ProcessingError({
              path: sourcePath,
              detail: `model download failed (curl exit ${exitCode}) — check the model name "${model}"`
            })
          )
        }
        yield* fs
          .rename(partial, modelPath)
          .pipe(
            Effect.mapError(
              (cause) => new ProcessingError({ path: sourcePath, detail: `model rename failed: ${String(cause)}`, cause })
            )
          )
      })

    return Transcriber.of({
      transcribe: (input) =>
        Effect.gen(function* () {
          yield* ensureModel(input.path)
          const dir = yield* fs
            .makeTempDirectoryScoped({ prefix: "upload-world-whisper-" })
            .pipe(
              Effect.mapError(
                (cause) => new ProcessingError({ path: input.path, detail: `temp staging failed: ${String(cause)}`, cause })
              )
            )
          const wav = pathMod.join(dir, "audio.wav")
          yield* fs
            .writeFile(wav, input.data)
            .pipe(
              Effect.mapError(
                (cause) => new ProcessingError({ path: input.path, detail: `temp staging failed: ${String(cause)}`, cause })
              )
            )
          // -np: no runtime prints, -nt: no timestamps → clean transcript on stdout
          const command = Command.make(bin, "-m", modelPath, "-f", wav, "-np", "-nt")
          const transcript = yield* Command.string(command).pipe(
            Effect.mapError(
              (cause) =>
                new ProcessingError({
                  path: input.path,
                  detail: `failed to run ${bin} — is whisper-cpp installed? (brew install whisper-cpp) (${String(cause)})`,
                  cause
                })
            )
          )
          const cleaned = transcript.trim()
          if (cleaned.length === 0) {
            return yield* Effect.fail(
              new ProcessingError({ path: input.path, detail: "whisper produced an empty transcript" })
            )
          }
          return cleaned
        }).pipe(provideExec, Effect.scoped)
    })
  })
)
