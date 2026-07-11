---
title: Swap the transcriber
description: Pick whisper.cpp, OpenAI, or Gemini transcription — or provide your own Transcriber Layer.
type: guide
tags:
  - wiki
  - guide
  - transcription
---
# Swap the transcriber

## Goal

Change how audio (and video soundtracks) become text — between the three shipped backends or your own.

## Steps

1. **Pick a shipped backend** — `--transcriber whisper|openai|gemini` on the [CLI](../modules/cli.md), or `transcriber:` in `AppConfig` ([server.ts](../../src/server.ts)). Defaults: `whisper` (local whisper.cpp) with a key, `gemini` in keyless/[mock](../concepts/mock-first.md) runs.
2. **Tune it via env** ([config.ts](../../src/config.ts)) — `UPLOAD_WORLD_WHISPER_MODEL` (tiny…large-v3-turbo, auto-downloaded), `UPLOAD_WORLD_WHISPER_MODEL_PATH` (explicit ggml file, skips download), `UPLOAD_WORLD_WHISPER_BIN`; `OPENAI_API_KEY` + `UPLOAD_WORLD_OPENAI_TRANSCRIBE_MODEL` for the API backend.
3. **Or bring your own** — implement `TranscriberService` ([Transcriber.ts](../../src/services/Transcriber.ts)): one method, `transcribe(input) → string`. Input is guaranteed to be [ffmpeg-conditioned](../modules/ffmpeg.md) 16 kHz mono WAV. Pass your Layer as `AppConfig.transcriberLayer` (it overrides `transcriber`).

## Relevant code

- Seam: [Transcriber.ts](../../src/services/Transcriber.ts) · backends: [TranscriberWhisperCpp.ts](../../src/services/TranscriberWhisperCpp.ts), [TranscriberOpenAI.ts](../../src/services/TranscriberOpenAI.ts), [TranscriberGemini.ts](../../src/services/TranscriberGemini.ts) · selection logic: `appLayer` in [server.ts](../../src/server.ts)

## Gotchas

- whisper.cpp needs the binary on PATH (`brew install whisper-cpp` → `whisper-cli`); the ggml model downloads to `~/.cache/upload-world/models` on **first transcription**, so the first audio ingest is slow.
- `openai` fails per-file (a `ProcessingError`, batch-skipped) when `OPENAI_API_KEY` is unset — the error surfaces at transcription time, not startup.
- The `gemini` backend spends model tokens per transcription and also returns a trailing `Summary:` paragraph — fine for search, but not a verbatim-only transcript.
- Your custom transcriber should treat an empty result as an error (WhisperCppLive does) so silent failures don't ingest empty documents.

## Related

- [Transcriber](../modules/transcriber.md) · [Video processing](../flows/video-processing.md)