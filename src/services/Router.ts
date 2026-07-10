import { Effect } from "effect"
import { UnsupportedMediaError } from "../domain.js"
import type { MediaKind } from "../domain.js"

const EXTENSIONS: Record<string, { kind: MediaKind; mimeType: string }> = {
  // text
  ".txt": { kind: "text", mimeType: "text/plain" },
  ".md": { kind: "text", mimeType: "text/markdown" },
  ".csv": { kind: "text", mimeType: "text/csv" },
  ".json": { kind: "text", mimeType: "application/json" },
  ".html": { kind: "text", mimeType: "text/html" },
  ".xml": { kind: "text", mimeType: "application/xml" },
  ".yaml": { kind: "text", mimeType: "application/yaml" },
  ".yml": { kind: "text", mimeType: "application/yaml" },
  // audio
  ".mp3": { kind: "audio", mimeType: "audio/mpeg" },
  ".wav": { kind: "audio", mimeType: "audio/wav" },
  ".m4a": { kind: "audio", mimeType: "audio/mp4" },
  ".flac": { kind: "audio", mimeType: "audio/flac" },
  ".ogg": { kind: "audio", mimeType: "audio/ogg" },
  ".aac": { kind: "audio", mimeType: "audio/aac" },
  // video
  ".mp4": { kind: "video", mimeType: "video/mp4" },
  ".mov": { kind: "video", mimeType: "video/quicktime" },
  ".webm": { kind: "video", mimeType: "video/webm" },
  ".mkv": { kind: "video", mimeType: "video/x-matroska" },
  ".avi": { kind: "video", mimeType: "video/x-msvideo" },
  // image
  ".png": { kind: "image", mimeType: "image/png" },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".gif": { kind: "image", mimeType: "image/gif" },
  ".webp": { kind: "image", mimeType: "image/webp" },
  ".heic": { kind: "image", mimeType: "image/heic" },
  ".svg": { kind: "text", mimeType: "image/svg+xml" },
  // pdf
  ".pdf": { kind: "pdf", mimeType: "application/pdf" }
}

/** Route a file path to its modality + mime type by extension. */
export const detectMedia = (
  path: string
): Effect.Effect<{ kind: MediaKind; mimeType: string }, UnsupportedMediaError> => {
  const dot = path.lastIndexOf(".")
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase()
  const match = EXTENSIONS[ext]
  return match !== undefined
    ? Effect.succeed(match)
    : Effect.fail(
        new UnsupportedMediaError({
          path,
          detail: `no route for extension "${ext || "(none)"}" — supported: ${Object.keys(EXTENSIONS).join(", ")}`
        })
      )
}
