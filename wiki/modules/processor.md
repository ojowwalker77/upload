---
title: Processor
description: "Normalizes every modality to text chunks: text is chunked (+summary), audio transcribed, video described+transcribed, images described, PDFs extracted."
type: module
tags:
  - wiki
  - module
  - processor
---
# Processor

## Summary

The `Processor` seam ([Processor.ts](../../src/services/Processor.ts)) turns one `IngestSource` into text [chunks](../concepts/chunking.md). `ProcessorLive` ([ProcessorLive.ts](../../src/services/ProcessorLive.ts)) implements the per-[modality](../concepts/media-kind.md) strategies, always passing audio/image/video through the [ffmpeg conditioning stage](../modules/ffmpeg.md) before any model sees bytes.

## Responsibilities

Per modality:

- **text** — decode strict UTF-8, chunk the raw text; above `SUMMARY_THRESHOLD` (2000 chars) prepend a [Gemini](../modules/gemini.md)-generated one-paragraph summary chunk flagged `metadata.summary: "true"`.
- **audio** — `ffmpeg.optimizeAudio` (16 kHz mono WAV) → [Transcriber](../modules/transcriber.md) → chunked transcript flagged `transcript: "true"`.
- **video** — `ffmpeg.extractVideo` → describe each key frame via Gemini (concurrency 3) in parallel with transcribing the audio track → combine into one text → chunk. See [Video processing](../flows/video-processing.md).
- **image** — `ffmpeg.optimizeImage` (≤1568px stripped JPEG) → Gemini describe (subjects, OCR, layout) → chunk.
- **pdf** — sent inline to Gemini with an extract-text-and-tables prompt; files over `MAX_INLINE_BYTES` (~19 MB) fail with a `ProcessingError` pointing at the future Files API upgrade.
- **mix** — rejected here by design: directories are decomposed by [`ingestPaths`](../modules/pipeline.md), not the processor.

Also owns `chunkText` (exported; the boundary-aware splitter — see [Chunking](../concepts/chunking.md)) and `documentIdOf` — a document id is the first 16 hex chars of the SHA-256 of the raw bytes, so chunk ids (`{documentId}:{index}`) are stable and re-ingesting a file replaces its chunks.

## Public API / entry points

`Processor` tag, `ProcessorLive` layer, `chunkText(text, options?)`, `ChunkOptions`.

## Key files

- [Processor.ts](../../src/services/Processor.ts) — interface + tag
- [ProcessorLive.ts](../../src/services/ProcessorLive.ts) — implementation, `chunkText`, the modality switch

## Dependencies

[Gemini](../modules/gemini.md), [Ffmpeg](../modules/ffmpeg.md), [Transcriber](../modules/transcriber.md) — all declared in the `ProcessorLive` Layer type.

## Participates in

- [Ingest flow](../flows/ingest.md), [Video processing](../flows/video-processing.md)

## Related

- [Chunking](../concepts/chunking.md), [Media kind](../concepts/media-kind.md)