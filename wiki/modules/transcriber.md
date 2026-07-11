---
title: Transcriber
description: "The speech-to-text seam over ffmpeg-conditioned audio: local whisper.cpp (default), OpenAI Whisper API, or Gemini-native transcription."
type: module
tags:
  - wiki
  - module
  - transcriber
  - whisper
---
# Transcriber

## Summary

`Transcriber` ([Transcriber.ts](../../src/services/Transcriber.ts)) is the speech-to-text seam. Input is always [ffmpeg-conditioned](../modules/ffmpeg.md) 16 kHz mono WAV — the [Processor](../modules/processor.md) guarantees that — so every backend gets ideal input.

## Responsibilities

Three implementations, selected by `--transcriber` / `AppConfig.transcriber` (see [Swap the transcriber](../guides/swap-the-transcriber.md)):

- **WhisperCppLive** ([TranscriberWhisperCpp.ts](../../src/services/TranscriberWhisperCpp.ts)) — the default: local `whisper-cli` (`brew install whisper-cpp`). The ggml model (`UPLOAD_WORLD_WHISPER_MODEL`, default `base`) auto-downloads from Hugging Face to `~/.cache/upload-world/models` on first use, via curl to a `.download` partial then an atomic rename; `UPLOAD_WORLD_WHISPER_MODEL_PATH` skips the download entirely (and errors if the file is missing rather than downloading). Runs `whisper-cli -m <model> -f <wav> -np -nt` for a clean transcript on stdout; an empty transcript is an error.
- **TranscriberOpenAILive** ([TranscriberOpenAI.ts](../../src/services/TranscriberOpenAI.ts)) — multipart POST to the OpenAI transcriptions endpoint (`whisper-1` by default); fails with a clear `ProcessingError` when `OPENAI_API_KEY` is unset.
- **TranscriberGeminiLive** ([TranscriberGemini.ts](../../src/services/TranscriberGemini.ts)) — delegates to [Gemini](../modules/gemini.md) `describeMedia` with a transcribe-verbatim prompt. No extra binary or key — and provided with `GeminiMock` it is fully deterministic, which is why keyless/mock runs default to it ([Mock-first](../concepts/mock-first.md)).

**TranscriberMock** ([mocks.ts](../../src/services/mocks.ts)) returns a deterministic transcript embedding the filename and byte length.

## Public API / entry points

`Transcriber` tag, `TranscriberService`, `WhisperCppLive`, `TranscriberOpenAILive`, `TranscriberGeminiLive`, `TranscriberMock`.

## Key files

Listed above, plus whisper/OpenAI config in [config.ts](../../src/config.ts).

## Dependencies

WhisperCpp: `CommandExecutor | FileSystem | Path`. OpenAI: `HttpClient`. Gemini: the `Gemini` seam.

## Participates in

- [Ingest flow](../flows/ingest.md) (audio branch), [Video processing](../flows/video-processing.md) (soundtrack)

## Related

- [Swap the transcriber](../guides/swap-the-transcriber.md)