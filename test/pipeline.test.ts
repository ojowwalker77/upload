import { NodeContext } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect } from "vitest"
import { ingestPaths, search } from "../src/pipeline.js"
import { GeminiMock } from "../src/services/GeminiMock.js"
import { FfmpegMock, TranscriberMock } from "../src/services/mocks.js"
import { ProcessorLive } from "../src/services/ProcessorLive.js"
import { MemoryVectorStoreLive } from "../src/stores/memory.js"

const TestLayer = Layer.mergeAll(
  GeminiMock,
  ProcessorLive.pipe(Layer.provide(Layer.mergeAll(GeminiMock, FfmpegMock, TranscriberMock))),
  MemoryVectorStoreLive,
  NodeContext.layer
)

describe("pipeline e2e (mock Gemini, memory store)", () => {
  it.effect("ingests fixtures and finds the right document", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), "upload-world-e2e-"))
      const cookingPath = join(dir, "cooking.md")
      const rocketsPath = join(dir, "rockets.md")
      writeFileSync(
        cookingPath,
        "# Sourdough baking\n\nKneading dough, hydration ratios, and oven temperature for crusty bread. Flour, yeast, salt."
      )
      writeFileSync(
        rocketsPath,
        "# Orbital mechanics\n\nRocket engines, delta-v budgets, staging, and propellant mass fractions for launch vehicles."
      )

      const report = yield* ingestPaths([dir])
      expect(report.skipped).toEqual([])
      expect(report.results.length).toBe(2)
      for (const r of report.results) {
        expect(r.chunks).toBeGreaterThan(0)
        expect(r.kind).toBe("text")
      }

      const hits = yield* search("baking bread dough in the oven", 2)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]?.chunk.sourcePath).toBe(cookingPath)
    }).pipe(Effect.provide(TestLayer))
  )

  it.effect("skips unsupported files instead of failing the batch", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), "upload-world-skip-"))
      writeFileSync(join(dir, "good.txt"), "supported content here")
      writeFileSync(join(dir, "bad.xyz"), "unsupported")

      const report = yield* ingestPaths([dir])
      expect(report.results.length).toBe(1)
      expect(report.skipped.length).toBe(1)
      expect(report.skipped[0]?.path).toContain("bad.xyz")
    }).pipe(Effect.provide(TestLayer))
  )

  it.effect("nonexistent path lands in skipped", () =>
    Effect.gen(function* () {
      const report = yield* ingestPaths(["/nope/definitely-missing.txt"])
      expect(report.results).toEqual([])
      expect(report.skipped.length).toBe(1)
    }).pipe(Effect.provide(TestLayer))
  )
})
