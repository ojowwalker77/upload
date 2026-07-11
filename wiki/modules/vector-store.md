---
title: Vector store
description: The pluggable persistence seam — upsert, search, count — with in-memory and SQLite + sqlite-vec adapters shipped.
type: module
tags:
  - wiki
  - module
  - storage
  - sqlite
---
# Vector store

## Summary

`VectorStore` ([VectorStore.ts](../../src/services/VectorStore.ts)) is the pluggable persistence seam: three methods — `upsert`, `search` (k-nearest by cosine), `count` — behind a `Context.Tag`. Anything that satisfies the interface behind a Layer is a valid destination; see [Bring your own vector store](../guides/bring-your-own-vector-store.md).

## Responsibilities

**MemoryVectorStoreLive** ([memory.ts](../../src/stores/memory.ts)) — a `Ref<Map<id, EmbeddedChunk>>`: upsert by id, brute-force cosine scan on search. Per-process; for tests and library embedding.

**SqliteVectorStoreLive(dbPath)** ([sqlite.ts](../../src/stores/sqlite.ts)) — single local file, no infra: `better-sqlite3` + the `sqlite-vec` extension (both optional dependencies), WAL mode, scoped acquire/release of the DB handle.

- **Lazy schema by dimensionality** — a `vec0` virtual table needs a fixed vector size, so the schema is created on first upsert from the first embedding's length, persisted in a `meta` table, and every later upsert/search validates against it (dimensionality mismatch is a hard `VectorStoreError`).
- Chunks live twice: full rows (metadata as JSON) in `chunks`, vectors as `Float32Array` blobs in the `chunks_vec` vec0 table with `distance_metric=cosine`. Upserts delete+insert both in one transaction.
- Search: `WHERE embedding MATCH ? AND k = ?` on the vec0 table, then hydrate rows by id; the wire score is `1 - distance` so higher is closer, matching the in-memory adapter.
- Searching or counting an uninitialized store returns empty/0 rather than erroring.

## Public API / entry points

`VectorStore` tag, `VectorStoreService`, `MemoryVectorStoreLive`, `SqliteVectorStoreLive(dbPath)` (`":memory:"` supported).

## Key files

- [VectorStore.ts](../../src/services/VectorStore.ts) · [memory.ts](../../src/stores/memory.ts) · [sqlite.ts](../../src/stores/sqlite.ts)

## Dependencies

Sqlite adapter: `better-sqlite3`, `sqlite-vec` (optionalDependencies in [package.json](../../package.json)). Memory adapter: none.

## Participates in

- [Ingest flow](../flows/ingest.md) (upsert), [Search flow](../flows/search.md) (knn)

## Related

- [Embeddings](../concepts/embeddings.md) — why cosine + L2 normalization
- [Bring your own vector store](../guides/bring-your-own-vector-store.md)