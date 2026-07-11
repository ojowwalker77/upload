---
title: Wiki Log
description: Append-only audit trail of wiki generation and refresh runs.
---

# Wiki Log

Append-only audit trail. Add one dated entry per generation or refresh run, recording the profile, the `source_commit` it was anchored to, and the coverage. The codebase-wiki skill describes the entry shape.

## 2026-07-10: generate

- Profile: internal/standard
- source_commit: adbd986
- Coverage: full `src/` tree — architecture (2), modules (8), flows (3), concepts (5), guides (3), overview hub
- Pages: [Overview](./OVERVIEW.md), [Effect service architecture](./architecture/service-layers.md), [Delivery surfaces](./architecture/delivery-surfaces.md), [Pipeline](./modules/pipeline.md), [CLI](./modules/cli.md), [HTTP API](./modules/http-api.md), [Processor](./modules/processor.md), [Gemini](./modules/gemini.md), [Ffmpeg](./modules/ffmpeg.md), [Transcriber](./modules/transcriber.md), [Vector store](./modules/vector-store.md), [Ingest](./flows/ingest.md), [Search](./flows/search.md), [Video processing](./flows/video-processing.md), [Effect layers](./concepts/effect-layers.md), [Chunking](./concepts/chunking.md), [Media kind](./concepts/media-kind.md), [Embeddings](./concepts/embeddings.md), [Mock-first](./concepts/mock-first.md), [Bring your own vector store](./guides/bring-your-own-vector-store.md), [Support a new file type](./guides/support-a-new-file-type.md), [Swap the transcriber](./guides/swap-the-transcriber.md)