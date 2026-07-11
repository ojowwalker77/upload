---
title: Ffmpeg
description: "The mandatory media-conditioning stage: 16 kHz mono WAV for speech, ≤1568px stripped JPEG for vision, scene-detected key frames + audio track for video."
type: module
tags:
  - wiki
  - module
  - ffmpeg
  - media
---
# Ffmpeg

## Summary

`Ffmpeg` ([Ffmpeg.ts](../../src/services/Ffmpeg.ts)) is the mandatory conditioning stage: every audio/image/video input passes through it **before any model sees bytes**. It shrinks payloads and normalizes formats to what the downstream models want. `FfmpegLive` ([FfmpegLive.ts](../../src/services/FfmpegLive.ts)) shells out to the real binary (`UPLOAD_WORLD_FFMPEG_BIN`, default `ffmpeg`), staging bytes through a scoped temp directory per operation.

## Responsibilities

- `optimizeAudio` — downmix mono, resample 16 kHz, loudness-normalize (`loudnorm=I=-16:TP=-1.5:LRA=11`) → PCM WAV: exactly what Whisper-family models want.
- `optimizeImage` — downscale to ≤1568 px on the long edge (vision models see no benefit beyond ~1.5k px), strip metadata, re-encode JPEG q3.
- `extractVideo` — scene-change detection (`select=gt(scene,0.30)`, always including frame 0) at ≤1024 px, capped at 12 frames; static footage that yields ≤1 frame falls back to 1 fps sampling. The audio track is extracted with the same speech conditioning, and is `Option.none` for silent video — silent/black videos are still describable.

Operational notes: stderr is captured for diagnostics (ffmpeg logs everything there; the last 800 chars end up in the `ProcessingError`), and a failed spawn produces an “is it installed and on PATH?” error.

**FfmpegMock** ([mocks.ts](../../src/services/mocks.ts)) passes bytes through untouched and “extracts” a video as a single frame with no audio — for tests and environments without the binary.

## Public API / entry points

`Ffmpeg` tag, `FfmpegService`, `MediaInput` / `OptimizedMedia` / `ExtractedVideo` types, `FfmpegLive`, `FfmpegMock`.

## Key files

- [Ffmpeg.ts](../../src/services/Ffmpeg.ts) · [FfmpegLive.ts](../../src/services/FfmpegLive.ts) · [mocks.ts](../../src/services/mocks.ts)

## Dependencies

`FfmpegLive`: `CommandExecutor | FileSystem | Path` (all from `NodeContext.layer`). No API keys — conditioning is key-free, so [appLayer](../architecture/service-layers.md) always defaults to the real binary even in mock runs.

## Participates in

- [Ingest flow](../flows/ingest.md) (audio/image branches), [Video processing](../flows/video-processing.md)

## Related

- [Processor](../modules/processor.md) — the only caller
- [Transcriber](../modules/transcriber.md) — consumes the conditioned audio