---
title: Pipeline
description: "The orchestration core: ingestData, ingestPath, ingestPaths and search — read, route, normalize, embed, store."
type: module
tags:
  - wiki
  - module
  - pipeline
---
# Pipeline

## Summary

[pipeline.ts](../../src/pipeline.ts) is the orchestration core. It owns no I/O of its own — it sequences the service seams: route a file by extension, normalize it to [chunks](../concepts/chunking.md) via the [Processor](../modules/processor.md), embed the chunk texts via [Gemini](../modules/gemini.md), and persist via the [VectorStore](../modules/vector-store.md).

## Responsibilities

- `ingestData(path, data)` — ingest raw bytes under a (file)name. The name only drives modality routing and provenance metadata, so uploads that never touch disk work too (this is what the [HTTP API](../modules/http-api.md) calls).
- `ingestPath(path)` — read one file from disk, then `ingestData`.
- `ingestPaths(paths)` — walk files and directories (recursing, skipping dotfiles), filter unsupported extensions, then ingest with **concurrency 4**. Per-file failures land in `skipped` — the batch itself never fails (its only error channel is `PlatformError`).
- `search(query, k)` — embed the query with `RETRIEVAL_QUERY` intent and return the k nearest chunks (see [Search flow](../flows/search.md)).
- `embedChunks` (internal) — batches embedding calls at `EMBED_BATCH = 100` texts per request.

## Public API / entry points

`ingestData`, `ingestPath`, `ingestPaths`, `search`, plus the `IngestResult` / `IngestReport` types — all re-exported from [index.ts](../../src/index.ts). Requirements are expressed in the Effect types: `Gemini | Processor | VectorStore` (plus `FileSystem` for the disk variants).

## Key files

- [pipeline.ts](../../src/pipeline.ts) — everything above
- [domain.ts](../../src/domain.ts) — the `Chunk` / `EmbeddedChunk` / `SearchHit` types it produces
- [Router.ts](../../src/services/Router.ts) — `detectMedia`, the extension → [media kind](../concepts/media-kind.md) table

## Dependencies

[Gemini](../modules/gemini.md), [Processor](../modules/processor.md), [VectorStore](../modules/vector-store.md), `FileSystem` from `@effect/platform`.

## Participates in

- [Ingest flow](../flows/ingest.md) — the whole flow is this module
- [Search flow](../flows/search.md)

## Related

- [Effect service architecture](../architecture/service-layers.md)
- [Embeddings](../concepts/embeddings.md)