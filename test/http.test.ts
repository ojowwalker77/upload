import { afterAll, describe, expect, it } from "vitest"
import { GeminiMock } from "../src/services/GeminiMock.js"
import { FfmpegMock, TranscriberMock } from "../src/services/mocks.js"
import { makeWebHandler } from "../src/server.js"
import { MemoryVectorStoreLive } from "../src/stores/memory.js"

const { dispose, handler } = makeWebHandler({
  gemini: GeminiMock,
  vectorStore: MemoryVectorStoreLive,
  ffmpeg: FfmpegMock,
  transcriberLayer: TranscriberMock,
  embedder: "mock"
})

afterAll(() => dispose())

const BASE = "http://upload.world"

describe("HTTP API (web handler, mock Gemini, memory store)", () => {
  it("ingests multipart uploads of mixed types and reports skips", async () => {
    const form = new FormData()
    form.append("files", new File(["# Baking\n\nSourdough, flour, hydration."], "baking.md"))
    form.append("files", new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }))
    form.append("files", new File(["???"], "weird.xyz"))

    const response = await handler(new Request(`${BASE}/ingest`, { method: "POST", body: form }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      results: Array<{ path: string; kind: string; chunks: number }>
      skipped: Array<{ path: string }>
    }
    expect(body.results.length).toBe(2)
    expect(body.results.map((r) => r.kind).sort()).toEqual(["image", "text"])
    expect(body.skipped.length).toBe(1)
    expect(body.skipped[0]?.path).toBe("weird.xyz")
  })

  it("ingests raw bytes with a filename query param", async () => {
    const response = await handler(
      new Request(`${BASE}/ingest/raw?filename=rockets.md`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: "# Rockets\n\nDelta-v, staging, propellant."
      })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { kind: string; chunks: number; documentId: string }
    expect(body.kind).toBe("text")
    expect(body.chunks).toBeGreaterThan(0)
  })

  it("returns 415 for unsupported raw uploads", async () => {
    const response = await handler(
      new Request(`${BASE}/ingest/raw?filename=blob.xyz`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: "nope"
      })
    )
    expect(response.status).toBe(415)
    const body = (await response.json()) as { _tag: string }
    expect(body._tag).toBe("UnsupportedMedia")
  })

  it("searches across previously ingested content", async () => {
    const response = await handler(
      new Request(`${BASE}/search?q=${encodeURIComponent("sourdough flour baking")}&k=2`)
    )
    expect(response.status).toBe(200)
    const hits = (await response.json()) as Array<{ sourcePath: string; score: number }>
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.sourcePath).toBe("baking.md")
  })

  it("reports status", async () => {
    const response = await handler(new Request(`${BASE}/status`))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { chunks: number }
    expect(body.chunks).toBeGreaterThanOrEqual(3)
  })
})
