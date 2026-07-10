import { NodeContext } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect } from "vitest"
import { Ffmpeg } from "../src/services/Ffmpeg.js"
import { FfmpegLive } from "../src/services/FfmpegLive.js"

/** Integration tests against the real ffmpeg binary, on media it synthesizes itself. */

let hasFfmpeg = true
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
} catch {
  hasFfmpeg = false
}

const TestLayer = Layer.mergeAll(FfmpegLive.pipe(Layer.provide(NodeContext.layer)), NodeContext.layer)

const dir = mkdtempSync(join(tmpdir(), "upload-world-ffmpeg-test-"))
const wavPath = join(dir, "tone.wav")
const pngPath = join(dir, "card.png")
const mp4Path = join(dir, "clip.mp4")

beforeAll(() => {
  if (!hasFfmpeg) return
  // 2s 440Hz tone, stereo 44.1k — the optimizer must fold it to mono 16k
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ac", "2", "-ar", "44100", wavPath], { stdio: "ignore" })
  // 2000px-wide test card — the optimizer must downscale to ≤1568
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=2000x1125:rate=1:duration=1", "-frames:v", "1", pngPath], { stdio: "ignore" })
  // 4s test video with audio track
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=10:duration=4", "-f", "lavfi", "-i", "sine=frequency=330:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", mp4Path],
    { stdio: "ignore" }
  )
})

describe.skipIf(!hasFfmpeg)("FfmpegLive (real binary)", () => {
  it.effect("optimizeAudio → 16 kHz mono WAV", () =>
    Effect.gen(function* () {
      const ffmpeg = yield* Ffmpeg
      const data = readFileSync(wavPath)
      const out = yield* ffmpeg.optimizeAudio({ path: wavPath, data, mimeType: "audio/wav" })
      expect(out.mimeType).toBe("audio/wav")
      // WAV header: channels at offset 22 (LE u16), sample rate at 24 (LE u32)
      const view = new DataView(out.data.buffer, out.data.byteOffset)
      expect(view.getUint16(22, true)).toBe(1)
      expect(view.getUint32(24, true)).toBe(16000)
    }).pipe(Effect.provide(TestLayer))
  )

  it.effect("optimizeImage → JPEG downscaled to ≤1568px wide", () =>
    Effect.gen(function* () {
      const ffmpeg = yield* Ffmpeg
      const data = readFileSync(pngPath)
      const out = yield* ffmpeg.optimizeImage({ path: pngPath, data, mimeType: "image/png" })
      expect(out.mimeType).toBe("image/jpeg")
      expect(out.data[0]).toBe(0xff) // JPEG SOI
      expect(out.data[1]).toBe(0xd8)
      const outPath = join(dir, "optimized.jpg")
      writeFileSync(outPath, out.data)
      const width = execFileSync(
        "ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", outPath]
      ).toString().trim()
      expect(Number(width)).toBeLessThanOrEqual(1568)
    }).pipe(Effect.provide(TestLayer))
  )

  it.effect("extractVideo → frames + audio track", () =>
    Effect.gen(function* () {
      const ffmpeg = yield* Ffmpeg
      const data = readFileSync(mp4Path)
      const out = yield* ffmpeg.extractVideo({ path: mp4Path, data, mimeType: "video/mp4" })
      expect(out.frames.length).toBeGreaterThan(0)
      expect(out.frames.length).toBeLessThanOrEqual(12)
      expect(out.frames[0]?.[0]).toBe(0xff) // JPEG frames
      expect(Option.isSome(out.audio)).toBe(true)
      if (Option.isSome(out.audio)) {
        const view = new DataView(out.audio.value.data.buffer, out.audio.value.data.byteOffset)
        expect(view.getUint32(24, true)).toBe(16000)
      }
    }).pipe(Effect.provide(TestLayer))
  )

  it.effect("fails with a ProcessingError on garbage bytes", () =>
    Effect.gen(function* () {
      const ffmpeg = yield* Ffmpeg
      const result = yield* ffmpeg
        .optimizeAudio({ path: "garbage.mp3", data: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" })
        .pipe(Effect.either)
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ProcessingError")
        expect(result.left.path).toBe("garbage.mp3")
      }
    }).pipe(Effect.provide(TestLayer))
  )
})
