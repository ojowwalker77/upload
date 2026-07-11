---
title: Bring your own vector store
description: Implement the 3-method VectorStoreService behind a Layer (pgvector, LanceDB, a SaaS) and plug it in — nothing else changes.
type: guide
tags:
  - wiki
  - guide
  - storage
---
# Bring your own vector store

## Goal

Persist chunks somewhere other than the shipped adapters — pgvector, LanceDB, a SaaS — by implementing the [VectorStore](../modules/vector-store.md) seam. The shipped adapters are ~50–200 lines; yours will be similar.

## Steps

1. **Implement `VectorStoreService`** ([VectorStore.ts](../../src/services/VectorStore.ts)): `upsert(chunks)` (insert-or-replace by `chunk.id`), `search(embedding, k)` (k-nearest by cosine, higher score = closer), and `count`. Fail with `VectorStoreError`, tagging the `operation`.
2. **Wrap it in a Layer** — follow [sqlite.ts](../../src/stores/sqlite.ts) for the shape: `Layer.scoped(VectorStore, Effect.gen(…))` with `Effect.acquireRelease` if you hold a connection.
3. **Plug it in** — either pass it as `AppConfig.vectorStore` to `appLayer` / `makeWebHandler` / `serverLayer` ([server.ts](../../src/server.ts)), or provide it directly in a library composition as the [README](../../README.md) shows.
4. **Test against the contract** — [stores.test.ts](../../test/stores.test.ts) exercises both shipped adapters; running your adapter through the same cases (upsert-replace semantics, empty-store search, k=0) is the cheapest correctness check.

## Relevant code

- Interface: [VectorStore.ts](../../src/services/VectorStore.ts) · reference adapters: [memory.ts](../../src/stores/memory.ts), [sqlite.ts](../../src/stores/sqlite.ts) · config hook: `AppConfig` in [server.ts](../../src/server.ts)

## Gotchas

- **Vectors arrive L2-normalized** (see [Embeddings](../concepts/embeddings.md)) — cosine and dot product are equivalent; pick whichever your engine does fast, but report *similarity* (higher = closer), not distance.
- **Upsert must replace by id** — chunk ids are deterministic ({sha256}:{index}, see [Chunking](../concepts/chunking.md)); re-ingest relies on replacement, not append.
- **Pin dimensionality** — embeddings have a fixed dim per deployment (`UPLOAD_WORLD_EMBEDDING_DIM`); validate like the sqlite adapter does or you'll store garbage silently.
- Searching an empty/uninitialized store should return `[]`, not error — `status` and first-run UX depend on it.

## Related

- [Vector store](../modules/vector-store.md) · [Effect layers](../concepts/effect-layers.md)