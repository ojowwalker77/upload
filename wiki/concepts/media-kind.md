---
title: Media kind
description: The six-modality vocabulary (text, audio, video, image, pdf, mix) and the extension table that routes every input.
type: concept
tags:
  - wiki
  - concept
  - routing
---
# Media kind

## Definition

`MediaKind` ([domain.ts](../../src/domain.ts)) is the modality vocabulary: `text | audio | video | image | pdf | mix`. `detectMedia` ([Router.ts](../../src/services/Router.ts)) maps a file path to a kind + MIME type purely by extension — ~30 extensions across the five concrete kinds (notably, `.svg` routes as **text**, since it is XML). Unknown extensions fail with an `UnsupportedMediaError` that lists everything supported.

## Why it matters

The kind selects the [Processor](../modules/processor.md) strategy — which conditioning, which model calls, which metadata — and is carried on every [chunk](./chunking.md) and search hit, so consumers can filter or present results by modality. `mix` is deliberately virtual: directories and multi-part inputs are decomposed by [`ingestPaths`](../modules/pipeline.md) into per-file ingests, and the processor rejects `mix` outright (combined-document fusion is planned, per the [README](../../README.md) limits).

Routing by extension (not content sniffing) keeps ingest byte-agnostic until the processor runs — that's also why `ingestData` works for uploads that never touch disk: the *name* is the router input.

## Where it lives

- Type: [domain.ts](../../src/domain.ts) · Table + `detectMedia`: [Router.ts](../../src/services/Router.ts) · Wire schema: `MediaKindSchema` in [api.ts](../../src/api.ts) · Tests: [router.test.ts](../../test/router.test.ts)

## Related

- [Ingest flow](../flows/ingest.md) · [Support a new file type](../guides/support-a-new-file-type.md)