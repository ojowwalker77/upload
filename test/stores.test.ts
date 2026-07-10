import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect } from "vitest"
import type { EmbeddedChunk } from "../src/domain.js"
import { VectorStore } from "../src/services/VectorStore.js"
import { MemoryVectorStoreLive } from "../src/stores/memory.js"
import { SqliteVectorStoreLive } from "../src/stores/sqlite.js"

const unit = (dim: number, axis: number): Array<number> => {
  const v = new Array<number>(dim).fill(0)
  v[axis] = 1
  return v
}

const chunk = (id: string, text: string, embedding: ReadonlyArray<number>): EmbeddedChunk => ({
  id,
  documentId: id.split(":")[0] ?? id,
  sourcePath: `/tmp/${id}.txt`,
  kind: "text",
  index: 0,
  text,
  metadata: { path: `/tmp/${id}.txt`, mimeType: "text/plain" },
  embedding
})

const DIM = 8

const storeSuite = (name: string, layer: () => Layer.Layer<VectorStore, unknown>) => {
  describe(name, () => {
    it.effect("upserts, counts, and searches nearest-first", () =>
      Effect.gen(function* () {
        const store = yield* VectorStore
        yield* store.upsert([
          chunk("a:0", "alpha", unit(DIM, 0)),
          chunk("b:0", "bravo", unit(DIM, 1)),
          chunk("c:0", "charlie", unit(DIM, 2))
        ])
        expect(yield* store.count).toBe(3)

        // query near axis 1 with a slight tilt toward axis 0
        const query = [0.3, 0.95, 0, 0, 0, 0, 0, 0]
        const hits = yield* store.search(query, 2)
        expect(hits.length).toBe(2)
        expect(hits[0]?.chunk.id).toBe("b:0")
        expect(hits[1]?.chunk.id).toBe("a:0")
        expect(hits[0]?.score ?? 0).toBeGreaterThan(hits[1]?.score ?? 0)
      }).pipe(Effect.provide(layer()))
    )

    it.effect("re-upserting the same id does not duplicate", () =>
      Effect.gen(function* () {
        const store = yield* VectorStore
        yield* store.upsert([chunk("a:0", "first version", unit(DIM, 0))])
        yield* store.upsert([chunk("a:0", "second version", unit(DIM, 0))])
        expect(yield* store.count).toBe(1)
        const hits = yield* store.search(unit(DIM, 0), 5)
        expect(hits.length).toBe(1)
        expect(hits[0]?.chunk.text).toBe("second version")
      }).pipe(Effect.provide(layer()))
    )
  })
}

storeSuite("MemoryVectorStore", () => MemoryVectorStoreLive)
storeSuite("SqliteVectorStore", () =>
  SqliteVectorStoreLive(join(mkdtempSync(join(tmpdir(), "upload-world-")), "test.db"))
)

describe("SqliteVectorStore specifics", () => {
  it.effect("search on an uninitialized store returns []", () =>
    Effect.gen(function* () {
      const store = yield* VectorStore
      const hits = yield* store.search(unit(DIM, 0), 3)
      expect(hits).toEqual([])
      expect(yield* store.count).toBe(0)
    }).pipe(
      Effect.provide(
        SqliteVectorStoreLive(join(mkdtempSync(join(tmpdir(), "upload-world-")), "empty.db"))
      )
    )
  )

  it.effect("persists across store instances (same file)", () =>
    Effect.gen(function* () {
      const dbPath = join(mkdtempSync(join(tmpdir(), "upload-world-")), "persist.db")
      yield* Effect.gen(function* () {
        const store = yield* VectorStore
        yield* store.upsert([chunk("p:0", "persisted", unit(DIM, 3))])
      }).pipe(Effect.provide(SqliteVectorStoreLive(dbPath)))

      yield* Effect.gen(function* () {
        const store = yield* VectorStore
        expect(yield* store.count).toBe(1)
        const hits = yield* store.search(unit(DIM, 3), 1)
        expect(hits[0]?.chunk.text).toBe("persisted")
        expect(hits[0]?.score ?? 0).toBeCloseTo(1, 4)
      }).pipe(Effect.provide(SqliteVectorStoreLive(dbPath)))
    })
  )
})
