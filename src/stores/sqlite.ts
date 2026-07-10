import Database from "better-sqlite3"
import { Effect, Layer } from "effect"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import * as sqliteVec from "sqlite-vec"
import { VectorStoreError } from "../domain.js"
import type { EmbeddedChunk, MediaKind, SearchHit } from "../domain.js"
import { VectorStore } from "../services/VectorStore.js"

interface ChunkRow {
  readonly id: string
  readonly document_id: string
  readonly source_path: string
  readonly kind: string
  readonly idx: number
  readonly text: string
  readonly metadata: string
  readonly embedding: string
}

const tryStore = <A>(
  operation: VectorStoreError["operation"],
  detail: string,
  thunk: () => A
): Effect.Effect<A, VectorStoreError> =>
  Effect.try({
    try: thunk,
    catch: (cause) => new VectorStoreError({ operation, detail: `${detail}: ${String(cause)}`, cause })
  })

const rowToChunk = (row: ChunkRow): EmbeddedChunk => ({
  id: row.id,
  documentId: row.document_id,
  sourcePath: row.source_path,
  kind: row.kind as MediaKind,
  index: row.idx,
  text: row.text,
  metadata: JSON.parse(row.metadata) as Readonly<Record<string, string>>,
  embedding: JSON.parse(row.embedding) as ReadonlyArray<number>
})

/**
 * SQLite + sqlite-vec adapter: a single local file, no infra.
 * The vec0 table needs a fixed dimensionality, so the schema is created
 * lazily on first upsert from the first embedding's length (persisted in
 * `meta` and validated afterwards).
 */
export const SqliteVectorStoreLive = (
  dbPath: string
): Layer.Layer<VectorStore, VectorStoreError> =>
  Layer.scoped(
    VectorStore,
    Effect.gen(function* () {
      const db = yield* Effect.acquireRelease(
        tryStore("init", `failed to open database at ${dbPath}`, () => {
          if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true })
          const handle = new Database(dbPath)
          sqliteVec.load(handle)
          handle.pragma("journal_mode = WAL")
          return handle
        }),
        (handle) => Effect.sync(() => handle.close())
      )

      const dimOf = (): number | undefined => {
        const row = db
          .prepare("SELECT value FROM meta WHERE key = 'dim'")
          .get() as { value: string } | undefined
        return row === undefined ? undefined : Number(row.value)
      }

      const isInitialized = (): boolean => {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
          .get()
        return row !== undefined
      }

      const initialize = (dim: number): void => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            source_path TEXT NOT NULL,
            kind TEXT NOT NULL,
            idx INTEGER NOT NULL,
            text TEXT NOT NULL,
            metadata TEXT NOT NULL,
            embedding TEXT NOT NULL
          );
          CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
            id TEXT PRIMARY KEY,
            embedding float[${dim}] distance_metric=cosine
          );
        `)
        db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('dim', ?)").run(String(dim))
      }

      const checkDim = (
        operation: VectorStoreError["operation"],
        actual: number
      ): Effect.Effect<void, VectorStoreError> => {
        const expected = dimOf()
        return expected !== undefined && expected !== actual
          ? Effect.fail(
              new VectorStoreError({
                operation,
                detail: `embedding dimensionality mismatch: store has ${expected}, got ${actual}`
              })
            )
          : Effect.void
      }

      return VectorStore.of({
        upsert: (chunks) =>
          chunks.length === 0
            ? Effect.void
            : Effect.gen(function* () {
                const first = chunks[0]
                if (first === undefined) return
                yield* tryStore("upsert", "failed to initialize schema", () => {
                  if (!isInitialized()) initialize(first.embedding.length)
                })
                yield* checkDim("upsert", first.embedding.length)
                yield* tryStore("upsert", `failed to upsert ${chunks.length} chunks`, () => {
                  const deleteChunk = db.prepare("DELETE FROM chunks WHERE id = ?")
                  const deleteVec = db.prepare("DELETE FROM chunks_vec WHERE id = ?")
                  const insertChunk = db.prepare(
                    "INSERT INTO chunks (id, document_id, source_path, kind, idx, text, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                  )
                  const insertVec = db.prepare("INSERT INTO chunks_vec (id, embedding) VALUES (?, ?)")
                  db.transaction(() => {
                    for (const chunk of chunks) {
                      deleteChunk.run(chunk.id)
                      deleteVec.run(chunk.id)
                      insertChunk.run(
                        chunk.id,
                        chunk.documentId,
                        chunk.sourcePath,
                        chunk.kind,
                        chunk.index,
                        chunk.text,
                        JSON.stringify(chunk.metadata),
                        JSON.stringify(chunk.embedding)
                      )
                      insertVec.run(chunk.id, Buffer.from(Float32Array.from(chunk.embedding).buffer))
                    }
                  })()
                })
              }),

        search: (embedding, k) =>
          Effect.gen(function* () {
            if (k <= 0) return []
            const ready = yield* tryStore("search", "failed to inspect schema", isInitialized)
            if (!ready) return []
            yield* checkDim("search", embedding.length)
            return yield* tryStore("search", "vector search failed", () => {
              const matches = db
                .prepare(
                  "SELECT id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance"
                )
                .all(Buffer.from(Float32Array.from(embedding).buffer), k) as Array<{
                id: string
                distance: number
              }>
              const byId = db.prepare(
                "SELECT id, document_id, source_path, kind, idx, text, metadata, embedding FROM chunks WHERE id = ?"
              )
              const hits: Array<SearchHit> = []
              for (const match of matches) {
                const row = byId.get(match.id) as ChunkRow | undefined
                if (row !== undefined) {
                  hits.push({ chunk: rowToChunk(row), score: 1 - match.distance })
                }
              }
              return hits
            })
          }),

        count: Effect.gen(function* () {
          const ready = yield* tryStore("search", "failed to inspect schema", isInitialized)
          if (!ready) return 0
          return yield* tryStore("search", "count failed", () => {
            const row = db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }
            return row.n
          })
        })
      })
    })
  )
