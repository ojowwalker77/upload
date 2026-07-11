---
title: Gemini
description: "The single seam to Google: generateText, describeMedia, embed. GeminiLive speaks the Generative Language REST API; GeminiMock is deterministic and offline."
type: module
tags:
  - wiki
  - module
  - gemini
---
# Gemini

## Summary

`Gemini` ([Gemini.ts](../../src/services/Gemini.ts)) is the single seam to Google. Because Gemini natively understands audio, video, images and PDFs, the whole multimodal story collapses into three methods: `generateText` (summaries), `describeMedia` (media-in, text-out with a modality-specific prompt), and `embed` (batch text [embeddings](../concepts/embeddings.md)).

## Responsibilities

**GeminiLive** ([GeminiLive.ts](../../src/services/GeminiLive.ts)) — REST client over `generativelanguage.googleapis.com/v1beta` using `@effect/platform` HttpClient:

- Auth via `x-goog-api-key`; models and dimensionality from [config.ts](../../src/config.ts) (`UPLOAD_WORLD_GEMINI_MODEL`, `UPLOAD_WORLD_EMBEDDING_MODEL`, `UPLOAD_WORLD_EMBEDDING_DIM`).
- Every request: 120 s timeout, then up to 3 retries with exponential backoff (500 ms base) — but only for transient failures (HTTP 429/5xx; network errors are tagged status 599 so they retry too).
- `describeMedia` sends bytes as base64 `inline_data` — hence the ~19 MB inline limit surfaced by the [Processor](../modules/processor.md).
- `embed` batches 100 texts per `batchEmbedContents` call, validates the response shape, and **L2-normalizes every vector** so cosine similarity is a plain dot product downstream. For Gemini Embedding 2 the `taskType` param is dropped and query intent becomes a prompt prefix (`task: search result | query: …`); legacy `gemini-embedding-001` keeps `taskType`.

**GeminiMock** ([GeminiMock.ts](../../src/services/GeminiMock.ts)) — deterministic offline stand-in: canned text for generate/describe, and bag-of-words hash embeddings (FNV-1a seed → mulberry32 PRNG → accumulated unit vectors, L2-normalized, 768-dim). Identical texts embed identically and shared vocabulary lands closer in cosine space — enough to exercise ingest → store → search offline. See [Mock-first](../concepts/mock-first.md).

## Public API / entry points

`Gemini` tag, `GeminiService` interface, `GeminiLive` (requires `HttpClient`), `GeminiMock` (requires nothing).

## Key files

- [Gemini.ts](../../src/services/Gemini.ts) · [GeminiLive.ts](../../src/services/GeminiLive.ts) · [GeminiMock.ts](../../src/services/GeminiMock.ts) · [config.ts](../../src/config.ts)

## Dependencies

`GeminiLive`: `HttpClient` + env config. `GeminiMock`: none.

## Participates in

- [Ingest flow](../flows/ingest.md) (describe/extract + document embeddings)
- [Search flow](../flows/search.md) (query embedding)
- [Video processing](../flows/video-processing.md) (frame descriptions)

## Related

- [Embeddings](../concepts/embeddings.md), [Mock-first](../concepts/mock-first.md)