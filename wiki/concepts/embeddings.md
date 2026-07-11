---
title: Embeddings
description: "Gemini Embedding 2: MRL-truncated dimensions, prompt-prefixed query intent instead of taskType, L2 normalization, cosine scoring."
type: concept
tags:
  - wiki
  - concept
  - embeddings
---
# Embeddings

## Definition

Every chunk text and every query is embedded by the [Gemini](../modules/gemini.md) seam into a vector of `UPLOAD_WORLD_EMBEDDING_DIM` dimensions (default 768; 128–3072 via MRL truncation). The default model is **`gemini-embedding-2`** ([config.ts](../../src/config.ts)); `gemini-embedding-001` remains available for legacy `taskType` behavior.

## Why it matters

Three decisions make similarity behave consistently everywhere:

- **Retrieval intent** — Embedding 2 dropped the `taskType` param, so intent is expressed on the *query* side as a prompt prefix (`task: search result | query: …` in [GeminiLive.ts](../../src/services/GeminiLive.ts)); documents embed raw. On the legacy model the same call sites pass `taskType` instead — the seam hides the difference behind `embed(texts, "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY")`.
- **L2 normalization** — `GeminiLive` normalizes every returned vector (as does [GeminiMock](./mock-first.md)), so cosine similarity, dot product, and Euclidean ranking coincide; the sqlite adapter's `distance_metric=cosine` and the in-memory cosine scan produce comparable scores (higher = closer, `score = 1 - distance` in sqlite — see [Vector store](../modules/vector-store.md)).
- **Fixed dimensionality per store** — batching is 100 texts per request, and the sqlite schema locks the dimension on first upsert; changing `UPLOAD_WORLD_EMBEDDING_DIM` against an existing DB is a hard error rather than silent garbage.

## Where it lives

- `embed` in [GeminiLive.ts](../../src/services/GeminiLive.ts) · config in [config.ts](../../src/config.ts) · batching in [pipeline.ts](../../src/pipeline.ts) · mock version in [GeminiMock.ts](../../src/services/GeminiMock.ts)

## Related

- [Search flow](../flows/search.md) · [Chunking](./chunking.md)