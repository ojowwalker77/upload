---
title: Chunking
description: How normalized text is split into overlapping, boundary-aware chunks — the unit that gets embedded, stored, and returned by search.
type: concept
tags:
  - wiki
  - concept
  - chunking
---
# Chunking

## Definition

A **chunk** is the atomic unit of the system: a piece of normalized text plus provenance (`id`, `documentId`, `sourcePath`, [kind](./media-kind.md), `index`, `metadata`) — the `Chunk` type in [domain.ts](../../src/domain.ts). An `EmbeddedChunk` adds its vector; a `SearchHit` pairs one with a cosine score.

`chunkText` in [ProcessorLive.ts](../../src/services/ProcessorLive.ts) splits text into chunks of ~1600 chars with 200-char overlap, preferring a paragraph boundary, then a sentence boundary, before a hard cut — and only takes a boundary if it keeps the chunk at least half-size.

## Why it matters

Chunk size bounds what one embedding must represent; overlap keeps context that straddles a cut retrievable from both sides. Chunk **identity** is also the upsert key: `{documentId}:{index}` where `documentId` is the first 16 hex chars of the SHA-256 of the raw bytes — so re-ingesting identical bytes overwrites its own chunks instead of duplicating them.

Long text documents (>2000 chars) additionally get a [Gemini](../modules/gemini.md)-generated summary as chunk 0, flagged `metadata.summary: "true"` — a dense hook for queries that match the gist rather than any single passage.

## Where it lives

- `chunkText` + `toChunks` + `documentIdOf`: [ProcessorLive.ts](../../src/services/ProcessorLive.ts) (exported via [index.ts](../../src/index.ts) with `ChunkOptions`)
- Types: [domain.ts](../../src/domain.ts)
- Exercised heavily in [chunker.test.ts](../../test/chunker.test.ts)

## Related

- [Processor](../modules/processor.md) · [Embeddings](./embeddings.md) · [Ingest flow](../flows/ingest.md)