# upload-world — Dream Spec

**One sentence:** a single component you drop into any application, on any hardware,
at any budget, that turns *any file* into *searchable meaning* — and never asks the
host app to care how.

```
        app / API / worker / CLI / edge
                    │  (one of 4 drop-in forms)
                    ▼
┌──────────────── upload-world ────────────────┐
│  Router → Condition → Understand → Embed → Store  │
│              (every stage = a seam with a         │
│               provider ladder, auto-resolved)     │
└───────────────────────────────────────────────┘
```

---

## 1. The invariant

Five capability seams. Each is an Effect `Context.Tag` with N providers.
The host picks providers explicitly — or lets the **resolver** probe the
environment (keys? binaries? RAM? GPU?) and pick the best available ladder rung.
Degradation is *graceful and loud*: the component always says what it resolved to.

| Seam | Providers (best → budget) | Status |
|---|---|---|
| **Condition** (mandatory) | ffmpeg — 16k mono loudnorm WAV · ≤1568px JPEG · ≤12 scene keyframes | ✅ shipped |
| **Transcribe** | whisper.cpp/Metal · faster-whisper int8 (CPU srv) · OpenAI API · Gemini | ✅ 3 of 4 · syncEngine adapter planned |
| **Describe** (vision) | Gemini Flash · gemma3:4b (Ollama) · moondream2 · *skip+warn* | ✅ Gemini · local planned |
| **Extract** (PDF) | Gemini · pdftotext + vision fallback | ✅ Gemini · pdftotext planned |
| **Embed** | gemini-embedding-2 · EmbeddingGemma-300m local via Ollama (768 MRL) · mock | ✅ all three |
| **Store** | sqlite-vec · memory · pgvector · libSQL/Turso · Qdrant | ✅ 2 of 5 |

Rules:
- **Nothing hits a model raw.** Condition always runs first for audio/image/video.
- **Transcripts carry time.** `Transcriber` returns `{ text, segments: [{text, start, end}] }`;
  chunks store `startTime`/`endTime` so search hits deep-link into media (syncEngine lesson).
- **The store records its embedding model + dims.** Mismatched queries fail loudly
  with "re-ingest or switch model", never silently return garbage neighbors.
- **Per-file failures never fail a batch.** They come back as `skipped[{path, reason}]`.

## 2. Hardware tiers (auto-detected, overridable)

| Tier | Hardware | Resolved profile | Cost |
|---|---|---|---|
| **T0 minimal** | 2 vCPU / 2 GB (small VM, Pi 5) | text+pdf+audio only: whisper `tiny` int8, EmbeddingGemma, pdftotext, vision **off (warned)** | $0 |
| **T1 laptop** | 8 GB M-series (this M2 Air) | local embed + whisper `base`/Metal + moondream2 — or **hybrid**: local everything, Gemini for vision only | $0 / ~pennies |
| **T2 local-max** | 16 GB+ M-series or ≥8 GB VRAM GPU | fully local: whisper `large-v3-turbo`, gemma3:4b vision, EmbeddingGemma | $0 |
| **T3 CPU server** | 8 vCPU / 16 GB VM | faster-whisper `small` int8, EmbeddingGemma, vision local-slow or hybrid | VM cost |
| **T4 keyed** | anything + `GEMINI_API_KEY` | Gemini everything (today's default) | API usage |

Resolver order: explicit config → keys present → binaries present (`ffmpeg`,
`whisper-cli`, `ollama`, `pdftotext`) → RAM/GPU probe → tier profile. Printed once
at startup and queryable forever:

```
GET /capabilities
{ "tier": "T1-hybrid",
  "providers": { "transcribe": "whisper.cpp/base/metal", "embed": "embeddinggemma-300m/768",
                 "describe": "gemini-2.5-flash", "extract": "pdftotext", "store": "sqlite-vec" },
  "offline": ["transcribe", "embed", "extract"], "warnings": [] }
```

## 3. Drop-in forms

| Form | Invocation | Status |
|---|---|---|
| CLI | `upload-world ingest/search/status/serve` | ✅ |
| HTTP server | `upload-world serve` — OpenAPI at `/docs` | ✅ |
| Web handler | `makeWebHandler()` → `(Request) => Promise<Response>` — Hono/Next/Bun/Lambda | ✅ |
| Effect Layer | `UploadWorldApiLive` into an existing Effect server | ✅ |
| npm library | `ingestData` / `search` as plain Effects | ✅ |
| Docker image | models baked in per tier (`upload-world:t2-local`) | ◻ planned |

## 4. API surface (dream additions on top of today's 4 endpoints)

- `POST /ingest` multipart · `POST /ingest/raw` — ✅ today, plus ◻ `202 + jobId`
  async mode with `GET /jobs/:id` (SSE progress) for large media.
- `GET /search` — ✅ today, plus ◻ `?after=12.5&kind=audio` filters and
  time-anchored hits: `{ "sourcePath": "talk.mp3", "startTime": 754.2, ... }`.
- `GET /status` — ✅ · `GET /capabilities` — ◻ the introspection contract above.
- ◻ `DELETE /documents/:id`, `GET /documents` — lifecycle.
- ◻ Webhook on ingest-complete for queue-driven hosts.

## 5. Non-negotiables

- **Privacy:** in T0–T2 profiles, bytes never leave the machine — enforced by
  construction (no HTTP client in the layer graph), not by promise.
- **Determinism:** mock layers keep the full pipeline runnable offline in CI, ever green.
- **One config:** env vars or a single `AppConfig` object; zero-config resolves to
  the best the machine can do.
- **Quality gate:** `pnpm check` = tsgo + oxlint + vitest, including real-ffmpeg
  integration tests that synthesize their own media.

## 6. Performance targets (per tier, honest numbers)

| Operation | T1 (this Air) | T2 (16GB M-series) | T4 (keyed) |
|---|---|---|---|
| 1 min audio → searchable | ~10 s | ~4 s | ~8 s (API RTT) |
| 1 image → searchable | hybrid: ~2 s | ~4 s local | ~2 s |
| 5 min video → searchable | ~60 s | ~30 s | ~25 s |
| search p50 @ 100k chunks (sqlite-vec) | < 30 ms | < 20 ms | < 30 ms |
| embed throughput (chunks/s) | ~80 local | ~200 local | ~500 batched |

## 7. Build order

1. ~~**Local embeddings** (EmbeddingGemma via Ollama) — unlocks T0–T3.~~ ✅ shipped, incl. the vector-space guard.
2. **Timed transcripts** (whisper.cpp `-oj` + syncEngine-style boundary scoring) — time-anchored chunks.
3. **`/capabilities` + resolver** — the auto-tier probe.
4. **pdftotext extract rung** — free PDFs.
5. **Local vision rung (Ollama)** — completes 100%-local.
6. **faster-whisper / syncEngine adapter** — best CPU-server transcription.
7. **Async jobs + time-filtered search** — production ergonomics.
8. **pgvector adapter + Docker images** — fleet deployment.
