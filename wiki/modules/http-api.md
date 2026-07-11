---
title: HTTP API
description: "Typed HttpApi definition (ingest, ingest/raw, search, status), status-mapped wire errors, and the turn-key wiring: appLayer, makeWebHandler, serverLayer."
type: module
tags:
  - wiki
  - module
  - http
---
# HTTP API

## Summary

The HTTP surface is split in two files: [api.ts](../../src/api.ts) declares the wire contract (an `@effect/platform` `HttpApi` with schemas), and [server.ts](../../src/server.ts) implements the handlers and the turn-key wiring. OpenAPI docs at `/docs` are derived from the same definition.

## Responsibilities

Endpoints (group `pipeline`):

| Endpoint | Payload | Success | Errors |
|---|---|---|---|
| `POST /ingest` | multipart, field `files` (any count) | `IngestReport` | 500 |
| `POST /ingest/raw?filename=` | raw bytes | `IngestResult` | 415 · 422 · 502 · 500 |
| `GET /search?q=&k=` | — (k defaults to 5) | `SearchHit[]` | 502 · 500 |
| `GET /status` | — | `{ chunks }` | 500 |

Domain errors map to wire errors in `toApiError` ([server.ts](../../src/server.ts)): `UnsupportedMediaError` → 415, `ProcessingError` → 422, `GeminiError` → 502, `VectorStoreError` → 500. Batch `/ingest` never fails the batch — per-file problems come back in `skipped`, mirroring [`ingestPaths`](../modules/pipeline.md).

## Public API / entry points

- `UploadWorldApi` — the `HttpApi` definition ([api.ts](../../src/api.ts))
- `PipelineHandlersLive`, `UploadWorldApiLive` — handlers and API-as-Layer
- `appLayer(config)` — config → full service stack (the composition root, see [Effect service architecture](../architecture/service-layers.md))
- `makeWebHandler(config)` — fetch-standard `(Request) => Promise<Response>` + `dispose`
- `serverLayer(config & { port })` — standalone Node server with Swagger

## Key files

- [api.ts](../../src/api.ts) — schemas (`IngestReportSchema`, `SearchHitSchema`, …) and the four status-mapped `Schema.TaggedError` wire errors
- [server.ts](../../src/server.ts) — handlers (multipart files are read back from temp paths via `FileSystem`), `toApiError`, `toWireHit` (flattens `SearchHit` for the wire), and the `AppConfig` interface with its bring-your-own-Layer overrides

## Dependencies

[Pipeline](../modules/pipeline.md) (`ingestData`, `search`), all five service seams via `appLayer`, `@effect/platform` HttpApi machinery, `NodeHttpServer`.

## Participates in

- [Ingest flow](../flows/ingest.md), [Search flow](../flows/search.md)

## Related

- [Delivery surfaces](../architecture/delivery-surfaces.md)