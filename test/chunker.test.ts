import { describe, expect, it } from "vitest"
import { chunkText } from "../src/services/ProcessorLive.js"

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("hello world")).toEqual(["hello world"])
  })

  it("returns [] for empty/whitespace text", () => {
    expect(chunkText("")).toEqual([])
    expect(chunkText("   \n\n  ")).toEqual([])
  })

  it("respects the size limit and produces no empty chunks", () => {
    const text = Array.from({ length: 100 }, (_, i) => `Sentence number ${i} is here. `).join("")
    const chunks = chunkText(text, { size: 300, overlap: 50 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk.length).toBeLessThanOrEqual(300)
    }
  })

  it("covers all content (every piece of the source appears in some chunk)", () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} talks about topic ${i}.`)
    const text = paragraphs.join("\n\n")
    const chunks = chunkText(text, { size: 200, overlap: 40 })
    const joined = chunks.join("\n")
    for (const p of paragraphs) expect(joined).toContain(p)
  })

  it("prefers paragraph boundaries", () => {
    const text = `${"a".repeat(900)}\n\n${"b".repeat(900)}`
    const chunks = chunkText(text, { size: 1000, overlap: 0 })
    expect(chunks[0]).toBe("a".repeat(900))
  })
})
