---
title: Effect layers
description: Context.Tag services and Layer composition — the dependency-injection backbone of upload-world.
type: concept
tags:
  - wiki
  - concept
  - effect
---
# Effect layers

## Definition

In the Effect ecosystem, a **`Context.Tag`** is a typed key for a service interface, and a **`Layer`** is a recipe that constructs an implementation of one or more tags (possibly requiring other tags to build). Programs request services by yielding their tags; `Effect.provide(layer)` satisfies those requirements at the edge.

## Why it matters

It is the entire extensibility story of upload-world. Every stage — [Gemini](../modules/gemini.md), [Processor](../modules/processor.md), [Ffmpeg](../modules/ffmpeg.md), [Transcriber](../modules/transcriber.md), [VectorStore](../modules/vector-store.md) — is a tag with swappable Layers, which is what makes the pipeline run identically in a CLI, a server, tests, or offline [mock](./mock-first.md) mode. Requirements are visible in types: `ProcessorLive: Layer<Processor, never, Gemini | Ffmpeg | Transcriber>` says exactly what it consumes.

## Where it lives

- Tags: `Context.Tag("upload-world/…")` in each seam file, e.g. [Gemini.ts](../../src/services/Gemini.ts), [VectorStore.ts](../../src/services/VectorStore.ts)
- Composition root: `appLayer` in [server.ts](../../src/server.ts) — see [Effect service architecture](../architecture/service-layers.md)
- Library-side composition example in the [README](../../README.md)

## Related

- [Effect service architecture](../architecture/service-layers.md) · [Mock-first](./mock-first.md)