---
title: Mock-first
description: "The pipeline runs end-to-end with no GEMINI_API_KEY: deterministic mock layers for Gemini, ffmpeg, and transcription."
type: concept
tags:
  - wiki
  - concept
  - testing
---
# Mock-first

## Definition

Every external dependency has a deterministic, offline Layer: `GeminiMock` ([GeminiMock.ts](../../src/services/GeminiMock.ts)) with bag-of-words hash embeddings, plus `FfmpegMock` and `TranscriberMock` ([mocks.ts](../../src/services/mocks.ts)). The full pipeline — ingest, store, search — works before you have a `GEMINI_API_KEY`.

## Why it matters

- **Zero-key onboarding** — `appLayer` in [server.ts](../../src/server.ts) auto-falls back to `GeminiMock` when the key is unset (the [CLI](../modules/cli.md) prints a note); `--mock` forces it. Keyless runs also default the [transcriber](../modules/transcriber.md) to the Gemini backend so no whisper binary or model download is needed for the demo.
- **Determinism as a feature** — mock embeddings are a seeded FNV-1a → mulberry32 projection: identical texts embed identically, shared vocabulary lands closer in cosine space. Search over mock-ingested content is *meaningfully* ranked, not random.
- **The test strategy** — the [test suite](../../test/pipeline.test.ts) runs the real [Processor](../modules/processor.md), pipeline, stores, and HTTP handlers against mock seams; only [ffmpeg.test.ts](../../test/ffmpeg.test.ts) touches a real binary. One caveat: a store built with mock embeddings is not searchable with live embeddings — same dimensionality, different space.

## Where it lives

- [GeminiMock.ts](../../src/services/GeminiMock.ts) · [mocks.ts](../../src/services/mocks.ts) · fallback logic in `appLayer` ([server.ts](../../src/server.ts))

## Related

- [Effect layers](./effect-layers.md) — why swapping is free · [Embeddings](./embeddings.md)