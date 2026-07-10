import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart } from "@effect/platform"
import { Schema } from "effect"

// ─── Wire schemas ────────────────────────────────────────────────────────────

export const MediaKindSchema = Schema.Literal("text", "audio", "video", "image", "pdf", "mix")

export const IngestResultSchema = Schema.Struct({
  documentId: Schema.String,
  path: Schema.String,
  kind: MediaKindSchema,
  chunks: Schema.Number
})

export const IngestReportSchema = Schema.Struct({
  results: Schema.Array(IngestResultSchema),
  skipped: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String }))
})

export const SearchHitSchema = Schema.Struct({
  score: Schema.Number,
  id: Schema.String,
  documentId: Schema.String,
  sourcePath: Schema.String,
  kind: MediaKindSchema,
  index: Schema.Number,
  text: Schema.String,
  metadata: Schema.Record({ key: Schema.String, value: Schema.String })
})

export const StatusSchema = Schema.Struct({ chunks: Schema.Number })

// ─── Wire errors (status-mapped) ─────────────────────────────────────────────

export class ApiUnsupportedMedia extends Schema.TaggedError<ApiUnsupportedMedia>()(
  "UnsupportedMedia",
  { path: Schema.String, detail: Schema.String }
) {}

export class ApiProcessingFailed extends Schema.TaggedError<ApiProcessingFailed>()(
  "ProcessingFailed",
  { path: Schema.String, detail: Schema.String }
) {}

export class ApiUpstreamFailed extends Schema.TaggedError<ApiUpstreamFailed>()(
  "UpstreamFailed",
  { detail: Schema.String }
) {}

export class ApiStoreFailed extends Schema.TaggedError<ApiStoreFailed>()(
  "StoreFailed",
  { detail: Schema.String }
) {}

// ─── Endpoints ───────────────────────────────────────────────────────────────

const ingest = HttpApiEndpoint.post("ingest", "/ingest")
  .setPayload(
    HttpApiSchema.Multipart(
      Schema.Struct({
        /** any number of files, any supported type — field name `files` */
        files: Multipart.FilesSchema
      })
    )
  )
  .addSuccess(IngestReportSchema)
  .addError(ApiStoreFailed, { status: 500 })

const ingestRaw = HttpApiEndpoint.post("ingestRaw", "/ingest/raw")
  .setUrlParams(Schema.Struct({ filename: Schema.String }))
  .setPayload(HttpApiSchema.Uint8Array())
  .addSuccess(IngestResultSchema)
  .addError(ApiUnsupportedMedia, { status: 415 })
  .addError(ApiProcessingFailed, { status: 422 })
  .addError(ApiUpstreamFailed, { status: 502 })
  .addError(ApiStoreFailed, { status: 500 })

const searchEndpoint = HttpApiEndpoint.get("search", "/search")
  .setUrlParams(
    Schema.Struct({
      q: Schema.String,
      k: Schema.optionalWith(Schema.NumberFromString, { default: () => 5 })
    })
  )
  .addSuccess(Schema.Array(SearchHitSchema))
  .addError(ApiUpstreamFailed, { status: 502 })
  .addError(ApiStoreFailed, { status: 500 })

const status = HttpApiEndpoint.get("status", "/status")
  .addSuccess(StatusSchema)
  .addError(ApiStoreFailed, { status: 500 })

/**
 * The HTTP surface: ingest anything (multipart or raw bytes), search, status.
 * OpenAPI docs are derived from this definition (served at /docs in `serve`).
 */
export class UploadWorldApi extends HttpApi.make("upload-world").add(
  HttpApiGroup.make("pipeline").add(ingest).add(ingestRaw).add(searchEndpoint).add(status)
) {}
