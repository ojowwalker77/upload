# upload-world

Multimodal ingest pipeline: throw any file at it — text, audio, video, image, PDF —
and it is normalized to text, embedded with Gemini embeddings, and stored in a
**pluggable vector store**.

```
file ──▶ Router ──▶ Processor (Gemini Flash) ──▶ text chunks ──▶ Gemini embeddings ──▶ VectorStore
             │                                                                            │
   text · audio · video · image · pdf                                    memory · sqlite-vec · yours
```

Built with **TypeScript 7 (tsgo)** and the **Effect** ecosystem. Library-first:
every stage is an Effect service behind a `Context.Tag`, wired with Layers — so the
same core drops into a CLI, an HTTP API, a queue worker, or a cron job on any VM,
and every stage (model provider, vector store, chunking) is swappable.

## Design notes

- **One provider, no ffmpeg/Whisper**: Gemini Flash natively understands audio,
  video, images and PDFs. The diagram's "Whisper → transcript" and "key frames →
  describe" collapse into a single `Gemini.describeMedia(mimeType, bytes, prompt)`
  seam with modality-specific prompts. Want real Whisper or a different provider?
  Implement the `Gemini` service interface and swap the Layer.
- **Pluggable storage**: `VectorStore` is a 3-method interface (`upsert`,
  `search`, `count`). Shipped adapters: in-memory and SQLite + sqlite-vec
  (single-file, zero infra). pgvector/LanceDB/SaaS are ~100-line adapters away.
- **Runs without a key**: `GeminiMock` is a deterministic offline layer
  (bag-of-words hash embeddings) so the full pipeline — ingest, store, search —
  works end-to-end before you have a `GEMINI_API_KEY`.

## CLI

```sh
pnpm dev ingest ./notes.md ./talk.mp3 ./demo.mp4 ./scan.pdf   # or a directory
pnpm dev search "what did the talk say about pricing?" --k 5
pnpm dev status
```

Options: `--store sqlite|memory` (default `sqlite`), `--db ./upload-world.db`,
`--mock` (force the offline Gemini layer; also used automatically when
`GEMINI_API_KEY` is unset).

## Library

```ts
import { Effect, Layer } from "effect"
import { NodeContext, NodeHttpClient } from "@effect/platform-node"
import { GeminiLive, SqliteVectorStoreLive, ProcessorLive, ingestPaths, search } from "upload-world"

const AppLayer = Layer.mergeAll(
  ProcessorLive,
  SqliteVectorStoreLive("./vectors.db")
).pipe(Layer.provideMerge(GeminiLive), Layer.provideMerge(NodeHttpClient.layer))

const program = Effect.gen(function* () {
  yield* ingestPaths(["./docs"])
  return yield* search("deployment checklist", 5)
})

program.pipe(Effect.provide(AppLayer), Effect.provide(NodeContext.layer), Effect.runPromise)
```

Bring your own store by implementing `VectorStoreService` and providing it as a
Layer — nothing else changes.

## Setup

```sh
pnpm install
cp .env.example .env   # add GEMINI_API_KEY when you have one
pnpm typecheck         # TypeScript 7 native (tsgo)
pnpm test
```

## Config (env)

| Variable | Default | |
|---|---|---|
| `GEMINI_API_KEY` | — | unset ⇒ mock layer |
| `UPLOAD_WORLD_GEMINI_MODEL` | `gemini-2.5-flash` | describe/transcribe/extract |
| `UPLOAD_WORLD_EMBEDDING_MODEL` | `gemini-embedding-001` | |
| `UPLOAD_WORLD_EMBEDDING_DIM` | `768` | MRL-truncated, re-normalized |

## Limits (v1)

- Media is sent inline to Gemini (≤ ~19 MB per file). Larger files need the
  Files API — planned as a transparent upgrade inside `GeminiLive`.
- "Mix" inputs are handled by decomposition: directories are walked and each
  file routed by modality; combined-document fusion is a planned processor.
