import { it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect } from "vitest"
import type { DocumentDescriptor, EmbeddedChunk } from "../src/domain.js"
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

const document = (id: string, corpusId: string, model = "test-model"): DocumentDescriptor => ({
  id,
  corpusId,
  sourceType: "fixture",
  sourceId: id,
  sourcePath: `/tmp/${id}.txt`,
  kind: "text",
  title: id,
  sourceUrl: null,
  contentHash: `hash-${id}`,
  embeddingModel: model,
  embeddingDim: DIM,
  metadata: { owner: corpusId }
})

const documentChunk = (
  documentId: string,
  corpusId: string,
  index: number,
  text: string,
  embedding: ReadonlyArray<number>
): EmbeddedChunk => ({
  id: `${documentId}:${index}`,
  documentId,
  sourcePath: `/tmp/${documentId}.txt`,
  kind: "text",
  index,
  text,
  metadata: {
    path: `/tmp/${documentId}.txt`,
    mimeType: "text/plain",
    corpusId,
    sourceType: "fixture",
    sourceId: documentId,
    embeddingModel: "test-model"
  },
  embedding
})

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
        expect(yield* store.count()).toBe(3)

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
        expect(yield* store.count()).toBe(1)
        const hits = yield* store.search(unit(DIM, 0), 5)
        expect(hits.length).toBe(1)
        expect(hits[0]?.chunk.text).toBe("second version")
      }).pipe(Effect.provide(layer()))
    )

    it.effect("atomically replaces a document and exposes lifecycle state", () =>
      Effect.gen(function* () {
        const store = yield* VectorStore
        const descriptor = document("replace-me", "corpus-a")
        const inserted = yield* store.replaceDocument(descriptor, [
          documentChunk(descriptor.id, descriptor.corpusId, 0, "old one", unit(DIM, 0)),
          documentChunk(descriptor.id, descriptor.corpusId, 1, "old two", unit(DIM, 1))
        ])
        expect(inserted).toBe("inserted")

        const updated = yield* store.replaceDocument(
          { ...descriptor, contentHash: "new-hash" },
          [documentChunk(descriptor.id, descriptor.corpusId, 0, "new only", unit(DIM, 2))]
        )
        expect(updated).toBe("updated")
        expect(yield* store.count({ corpusId: "corpus-a" })).toBe(1)

        const stored = yield* store.getDocument(descriptor.id)
        expect(Option.isSome(stored)).toBe(true)
        if (Option.isSome(stored)) {
          expect(stored.value.contentHash).toBe("new-hash")
          expect(stored.value.chunkCount).toBe(1)
          expect(stored.value.createdAt.length).toBeGreaterThan(0)
        }
        const listed = yield* store.listDocuments("corpus-a")
        expect(listed.map((item) => item.id)).toEqual([descriptor.id])
        const hits = yield* store.search(unit(DIM, 2), 5, { corpusId: "corpus-a" })
        expect(hits.map((hit) => hit.chunk.text)).toEqual(["new only"])
      }).pipe(Effect.provide(layer()))
    )

    it.effect("isolates corpora, filters document ids, and deletes all vectors", () =>
      Effect.gen(function* () {
        const store = yield* VectorStore
        const alpha = document("alpha-doc", "alpha")
        const beta = document("beta-doc", "beta")
        yield* store.replaceDocument(alpha, [
          documentChunk(alpha.id, alpha.corpusId, 0, "alpha", unit(DIM, 0))
        ])
        yield* store.replaceDocument(beta, [
          documentChunk(beta.id, beta.corpusId, 0, "beta", unit(DIM, 0))
        ])

        const alphaHits = yield* store.search(unit(DIM, 0), 5, { corpusId: "alpha" })
        expect(alphaHits.map((hit) => hit.chunk.documentId)).toEqual([alpha.id])
        const betaHits = yield* store.search(unit(DIM, 0), 5, {
          documentIds: [beta.id]
        })
        expect(betaHits.map((hit) => hit.chunk.documentId)).toEqual([beta.id])

        expect(yield* store.deleteDocument(alpha.id)).toBe(true)
        expect(yield* store.deleteDocument(alpha.id)).toBe(false)
        expect(yield* store.count({ corpusId: "alpha" })).toBe(0)
        expect(yield* store.count({ corpusId: "beta" })).toBe(1)
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
      expect(yield* store.count()).toBe(0)
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
        expect(yield* store.count()).toBe(1)
        const hits = yield* store.search(unit(DIM, 3), 1)
        expect(hits[0]?.chunk.text).toBe("persisted")
        expect(hits[0]?.score ?? 0).toBeCloseTo(1, 4)
      }).pipe(Effect.provide(SqliteVectorStoreLive(dbPath)))
    })
  )
})
