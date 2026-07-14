import Database from "better-sqlite3"
import { Effect, Layer, Option } from "effect"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import * as sqliteVec from "sqlite-vec"
import { DEFAULT_CORPUS_ID, VectorStoreError } from "../domain.js"
import type {
  DocumentDescriptor,
  DocumentWriteStatus,
  EmbeddedChunk,
  MediaKind,
  SearchFilter,
  SearchHit,
  StoredDocument
} from "../domain.js"
import { VectorStore } from "../services/VectorStore.js"
import type { StoreMeta } from "../services/VectorStore.js"
import { metaOfChunk } from "./memory.js"

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

interface DocumentRow {
  readonly id: string
  readonly corpus_id: string
  readonly source_type: string
  readonly source_id: string
  readonly source_path: string
  readonly kind: string
  readonly title: string
  readonly source_url: string | null
  readonly content_hash: string
  readonly embedding_model: string
  readonly embedding_dim: number
  readonly metadata: string
  readonly chunk_count: number
  readonly created_at: string
  readonly updated_at: string
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

const rowToDocument = (row: DocumentRow): StoredDocument => ({
  id: row.id,
  corpusId: row.corpus_id,
  sourceType: row.source_type,
  sourceId: row.source_id,
  sourcePath: row.source_path,
  kind: row.kind as MediaKind,
  title: row.title,
  sourceUrl: row.source_url,
  contentHash: row.content_hash,
  embeddingModel: row.embedding_model,
  embeddingDim: row.embedding_dim,
  metadata: JSON.parse(row.metadata) as Readonly<Record<string, unknown>>,
  chunkCount: row.chunk_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const inferredDocument = (chunks: ReadonlyArray<EmbeddedChunk>): DocumentDescriptor | undefined => {
  const first = chunks[0]
  if (first === undefined) return undefined
  const meta = metaOfChunk(first)
  return {
    id: first.documentId,
    corpusId: first.metadata["corpusId"] ?? DEFAULT_CORPUS_ID,
    sourceType: first.metadata["sourceType"] ?? "legacy",
    sourceId: first.metadata["sourceId"] ?? first.sourcePath,
    sourcePath: first.sourcePath,
    kind: first.kind,
    title: first.metadata["title"] ?? first.sourcePath,
    sourceUrl: first.metadata["sourceUrl"] ?? null,
    contentHash: first.metadata["contentHash"] ?? first.documentId,
    embeddingModel: meta.model,
    embeddingDim: meta.dim,
    metadata: {}
  }
}

const documentColumns =
  "id, corpus_id, source_type, source_id, source_path, kind, title, source_url, content_hash, embedding_model, embedding_dim, metadata, chunk_count, created_at, updated_at"

/**
 * SQLite + sqlite-vec adapter. Vector search remains exact and unfiltered in
 * sqlite-vec, then corpus/document filtering is applied before returning hits.
 * The future pgvector adapter can push these filters into SQL.
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

      yield* tryStore("init", "failed to initialize document schema", () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            corpus_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_path TEXT NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            source_url TEXT,
            content_hash TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            embedding_dim INTEGER NOT NULL,
            metadata TEXT NOT NULL,
            chunk_count INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(corpus_id, source_type, source_id)
          );
          CREATE INDEX IF NOT EXISTS documents_corpus_idx ON documents(corpus_id);
        `)
      })

      const dimOf = (): number | undefined => {
        const row = db
          .prepare("SELECT value FROM meta WHERE key = 'dim'")
          .get() as { value: string } | undefined
        return row === undefined ? undefined : Number(row.value)
      }

      const modelOf = (): string | undefined => {
        const row = db
          .prepare("SELECT value FROM meta WHERE key = 'model'")
          .get() as { value: string } | undefined
        return row?.value
      }

      const tableExists = (name: string): boolean => {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(name)
        return row !== undefined
      }

      const isInitialized = (): boolean => tableExists("meta") && tableExists("chunks_vec") && dimOf() !== undefined

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
          CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id);
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

      const replaceDocument = (
        document: DocumentDescriptor,
        chunks: ReadonlyArray<EmbeddedChunk>
      ): Effect.Effect<DocumentWriteStatus, VectorStoreError> =>
        Effect.gen(function* () {
          for (const chunk of chunks) {
            if (chunk.documentId !== document.id) {
              return yield* Effect.fail(
                new VectorStoreError({
                  operation: "upsert",
                  detail: `chunk ${chunk.id} belongs to ${chunk.documentId}, expected ${document.id}`
                })
              )
            }
            const meta = metaOfChunk(chunk)
            if (meta.model !== document.embeddingModel || meta.dim !== document.embeddingDim) {
              return yield* Effect.fail(
                new VectorStoreError({
                  operation: "upsert",
                  detail: `chunk ${chunk.id} uses ${meta.model}/${meta.dim}, expected ${document.embeddingModel}/${document.embeddingDim}`
                })
              )
            }
          }

          yield* tryStore("upsert", "failed to initialize vector schema", () => {
            if (!isInitialized()) initialize(document.embeddingDim)
          })
          yield* checkDim("upsert", document.embeddingDim)
          const existingModel = yield* tryStore("upsert", "failed to read store meta", modelOf)
          if (existingModel !== undefined && existingModel !== document.embeddingModel) {
            return yield* Effect.fail(
              new VectorStoreError({
                operation: "upsert",
                detail: `store was embedded with "${existingModel}", incoming document uses "${document.embeddingModel}" — re-ingest or switch embedder`
              })
            )
          }

          return yield* tryStore("upsert", `failed to replace document ${document.id}`, () => {
            const existing = db.prepare("SELECT created_at FROM documents WHERE id = ?").get(document.id) as
              | { created_at: string }
              | undefined
            const status: DocumentWriteStatus = existing === undefined ? "inserted" : "updated"
            const now = new Date().toISOString()
            db.transaction(() => {
              db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('model', ?)").run(document.embeddingModel)
              db.prepare("DELETE FROM chunks_vec WHERE id IN (SELECT id FROM chunks WHERE document_id = ?)").run(document.id)
              db.prepare("DELETE FROM chunks WHERE document_id = ?").run(document.id)

              db.prepare(
                `INSERT INTO documents (${documentColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   corpus_id = excluded.corpus_id,
                   source_type = excluded.source_type,
                   source_id = excluded.source_id,
                   source_path = excluded.source_path,
                   kind = excluded.kind,
                   title = excluded.title,
                   source_url = excluded.source_url,
                   content_hash = excluded.content_hash,
                   embedding_model = excluded.embedding_model,
                   embedding_dim = excluded.embedding_dim,
                   metadata = excluded.metadata,
                   chunk_count = excluded.chunk_count,
                   updated_at = excluded.updated_at`
              ).run(
                document.id,
                document.corpusId,
                document.sourceType,
                document.sourceId,
                document.sourcePath,
                document.kind,
                document.title,
                document.sourceUrl,
                document.contentHash,
                document.embeddingModel,
                document.embeddingDim,
                JSON.stringify(document.metadata),
                chunks.length,
                existing?.created_at ?? now,
                now
              )

              const insertChunk = db.prepare(
                "INSERT INTO chunks (id, document_id, source_path, kind, idx, text, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
              )
              const insertVec = db.prepare("INSERT INTO chunks_vec (id, embedding) VALUES (?, ?)")
              for (const chunk of chunks) {
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
            return status
          })
        })

      const documentMap = (): ReadonlyMap<string, StoredDocument> => {
        const rows = db.prepare(`SELECT ${documentColumns} FROM documents`).all() as Array<DocumentRow>
        return new Map(rows.map((row) => [row.id, rowToDocument(row)]))
      }

      const matchesFilter = (
        chunk: EmbeddedChunk,
        documents: ReadonlyMap<string, StoredDocument>,
        filter?: SearchFilter
      ): boolean => {
        if (filter === undefined) return true
        if (filter.documentIds !== undefined && !filter.documentIds.includes(chunk.documentId)) return false
        if (filter.corpusId !== undefined) {
          const corpusId = documents.get(chunk.documentId)?.corpusId ??
            chunk.metadata["corpusId"] ?? DEFAULT_CORPUS_ID
          if (corpusId !== filter.corpusId) return false
        }
        return true
      }

      return VectorStore.of({
        upsert: (chunks) =>
          Effect.gen(function* () {
            const groups = new Map<string, Array<EmbeddedChunk>>()
            for (const chunk of chunks) {
              const group = groups.get(chunk.documentId) ?? []
              group.push(chunk)
              groups.set(chunk.documentId, group)
            }
            for (const group of groups.values()) {
              const document = inferredDocument(group)
              if (document !== undefined) yield* replaceDocument(document, group)
            }
          }),

        replaceDocument,

        search: (embedding, k, filter) =>
          Effect.gen(function* () {
            if (k <= 0) return []
            const ready = yield* tryStore("search", "failed to inspect schema", isInitialized)
            if (!ready) return []
            yield* checkDim("search", embedding.length)
            return yield* tryStore("search", "vector search failed", () => {
              const total = (db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n
              if (total === 0) return []
              const candidateCount = filter === undefined ? Math.min(k, total) : total
              const matches = db
                .prepare("SELECT id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance")
                .all(Buffer.from(Float32Array.from(embedding).buffer), candidateCount) as Array<{
                  id: string
                  distance: number
                }>
              const byId = db.prepare(
                "SELECT id, document_id, source_path, kind, idx, text, metadata, embedding FROM chunks WHERE id = ?"
              )
              const documents = documentMap()
              const hits: Array<SearchHit> = []
              for (const match of matches) {
                const row = byId.get(match.id) as ChunkRow | undefined
                if (row === undefined) continue
                const chunk = rowToChunk(row)
                if (!matchesFilter(chunk, documents, filter)) continue
                hits.push({ chunk, score: 1 - match.distance })
                if (hits.length >= k) break
              }
              return hits
            })
          }),

        count: (filter) =>
          Effect.gen(function* () {
            const ready = yield* tryStore("search", "failed to inspect schema", isInitialized)
            if (!ready) return 0
            return yield* tryStore("search", "count failed", () => {
              if (filter === undefined) {
                return (db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n
              }
              const rows = db
                .prepare("SELECT id, document_id, source_path, kind, idx, text, metadata, embedding FROM chunks")
                .all() as Array<ChunkRow>
              const documents = documentMap()
              return rows.reduce(
                (count, row) => count + (matchesFilter(rowToChunk(row), documents, filter) ? 1 : 0),
                0
              )
            })
          }),

        getDocument: (documentId) =>
          tryStore("list", `failed to read document ${documentId}`, () => {
            const row = db
              .prepare(`SELECT ${documentColumns} FROM documents WHERE id = ?`)
              .get(documentId) as DocumentRow | undefined
            return row === undefined ? Option.none<StoredDocument>() : Option.some(rowToDocument(row))
          }),

        listDocuments: (corpusId) =>
          tryStore("list", `failed to list corpus ${corpusId}`, () => {
            const rows = db
              .prepare(`SELECT ${documentColumns} FROM documents WHERE corpus_id = ? ORDER BY updated_at DESC`)
              .all(corpusId) as Array<DocumentRow>
            return rows.map(rowToDocument)
          }),

        deleteDocument: (documentId) =>
          tryStore("delete", `failed to delete document ${documentId}`, () => {
            const exists = db.prepare("SELECT 1 FROM documents WHERE id = ?").get(documentId) !== undefined
            if (!exists) return false
            db.transaction(() => {
              const ids = db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(documentId) as Array<{ id: string }>
              const deleteVec = db.prepare("DELETE FROM chunks_vec WHERE id = ?")
              for (const row of ids) deleteVec.run(row.id)
              db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId)
              db.prepare("DELETE FROM documents WHERE id = ?").run(documentId)
              const remaining = (db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n
              if (remaining === 0) {
                db.exec("DROP TABLE IF EXISTS chunks_vec")
                db.prepare("DELETE FROM meta").run()
              }
            })()
            return true
          }),

        meta: Effect.gen(function* () {
          const ready = yield* tryStore("search", "failed to inspect schema", isInitialized)
          if (!ready) return Option.none<StoreMeta>()
          return yield* tryStore("search", "meta read failed", () => {
            const model = modelOf()
            const dim = dimOf()
            return model !== undefined && dim !== undefined
              ? Option.some<StoreMeta>({ model, dim })
              : Option.none<StoreMeta>()
          })
        })
      })
    })
  )
