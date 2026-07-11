---
title: CLI
description: "The upload-world command line: ingest, search, status, serve — built with @effect/cli on top of appLayer."
type: module
tags:
  - wiki
  - module
  - cli
---
# CLI

## Summary

[cli.ts](../../src/cli.ts) is the `upload-world` binary (`bin` in [package.json](../../package.json)): four subcommands built with `@effect/cli`, each providing the shared `appLayer` from [server.ts](../../src/server.ts) so CLI behavior matches the HTTP surface exactly.

## Responsibilities

- `ingest <path…>` — run [`ingestPaths`](../modules/pipeline.md) over files/directories, print per-file results and a skipped list.
- `search <query> [-k N]` — semantic search, printing score, source path, kind, and a 200-char snippet per hit.
- `status` — print the stored chunk count. Always uses `mock: true` (no model calls are needed to count).
- `serve [-p port]` — launch the standalone HTTP server via `serverLayer` (see [Delivery surfaces](../architecture/delivery-surfaces.md)).

## Public API / entry points

Invoked as `pnpm dev <cmd>` or the built `upload-world` binary. Shared options: `--store sqlite|memory` (default `sqlite`), `--db <path>` (default `./upload-world.db`), `--mock`, `--transcriber whisper|openai|gemini` (default `whisper`).

## Key files

- [cli.ts](../../src/cli.ts) — the whole module; note the `note` effect that warns on stderr when `GEMINI_API_KEY` is unset and the run silently falls back to the mock layer ([Mock-first](../concepts/mock-first.md))

## Dependencies

[Pipeline](../modules/pipeline.md), `appLayer`/`serverLayer` from [server.ts](../../src/server.ts), [VectorStore](../modules/vector-store.md) (for `status`), `@effect/cli`, `NodeContext`/`NodeRuntime`.

## Participates in

- [Ingest flow](../flows/ingest.md), [Search flow](../flows/search.md)

## Related

- [Delivery surfaces](../architecture/delivery-surfaces.md)