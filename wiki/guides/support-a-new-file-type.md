---
title: Support a new file type
description: Add an extension to the router table — or wire a whole new modality through domain, processor, and API schema.
type: guide
tags:
  - wiki
  - guide
  - routing
---
# Support a new file type

## Goal

Make `ingest` accept a file it currently skips with `UnsupportedMediaError`.

## Steps

**Case A — new extension, existing modality** (the common case, e.g. `.rst` as text):

1. Add one line to the `EXTENSIONS` table in [Router.ts](../../src/services/Router.ts) with the right [kind](../concepts/media-kind.md) + MIME type.
2. Add a case to [router.test.ts](../../test/router.test.ts). Done — the [Processor](../modules/processor.md) strategy for that kind takes over.

**Case B — a genuinely new modality:**

1. Extend the `MediaKind` union in [domain.ts](../../src/domain.ts).
2. Add its extensions to [Router.ts](../../src/services/Router.ts).
3. Add a `case` to the modality switch in [ProcessorLive.ts](../../src/services/ProcessorLive.ts) — decide its conditioning ([ffmpeg](../modules/ffmpeg.md)?) and model calls ([Gemini](../modules/gemini.md) describe? [Transcriber](../modules/transcriber.md)?), and end at `toChunks`.
4. Update `MediaKindSchema` in [api.ts](../../src/api.ts) — the wire schema is a separate literal list and will reject unknown kinds otherwise (the `ingest` handler in [server.ts](../../src/server.ts) also names the kinds in a local type).
5. Cover it in [pipeline.test.ts](../../test/pipeline.test.ts) with the mock layers ([Mock-first](../concepts/mock-first.md)).

## Relevant code

- [Router.ts](../../src/services/Router.ts) · [domain.ts](../../src/domain.ts) · [ProcessorLive.ts](../../src/services/ProcessorLive.ts) · [api.ts](../../src/api.ts)

## Gotchas

- Routing is by extension only — no content sniffing. A misnamed file routes wrong and fails at processing time, not routing time.
- Keep the TypeScript `MediaKind` and the `Schema.Literal` wire list in sync by hand; the compiler flags the processor switch (it's exhaustive) but not the schema.
- Binary-ish text formats (like `.svg`) can route as `text` if UTF-8 decoding is safe — the text branch uses a **fatal** UTF-8 decoder, so non-text bytes fail loudly with a `ProcessingError`.

## Related

- [Media kind](../concepts/media-kind.md) · [Ingest flow](../flows/ingest.md)