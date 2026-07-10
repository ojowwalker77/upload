import { Effect, Either, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { detectMedia } from "../src/services/Router.js"

const run = (path: string) => Effect.runSync(Effect.either(detectMedia(path)))

describe("Router.detectMedia", () => {
  it("routes common extensions to the right modality", () => {
    const cases = [
      ["notes.md", "text"],
      ["talk.mp3", "audio"],
      ["demo.mp4", "video"],
      ["shot.PNG", "image"],
      ["scan.pdf", "pdf"]
    ] as const
    for (const [path, kind] of cases) {
      const result = run(path)
      expect(Either.isRight(result), path).toBe(true)
      if (Either.isRight(result)) expect(result.right.kind).toBe(kind)
    }
  })

  it("fails unknown extensions with UnsupportedMediaError", () => {
    const exit = Effect.runSyncExit(detectMedia("weird.xyz"))
    expect(Exit.isFailure(exit)).toBe(true)
    const result = run("weird.xyz")
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("UnsupportedMediaError")
      expect(result.left.detail).toContain(".xyz")
    }
  })

  it("fails extensionless paths", () => {
    expect(Either.isLeft(run("Makefile"))).toBe(true)
  })
})
