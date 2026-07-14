import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart } from "@effect/platform"
import { Schema } from "effect"

// ─── Wire schemas ────────────────────────────────────────────────────────────

export const MediaKindSchema = Schema.Literal("text", "audio", "video", "image", "pdf", "mix")

export const IngestResultSchema = Schema.Struct({
  documentId: Schema.String,
  corpusId: Schema.String,
  sourceType: Schema.String,
  sourceId: Schema.String,
  path: Schema.String,
  kind: MediaKindSchema,
  chunks: Schema.Number,
  status: Schema.Literal("inserted", "updated", "unchanged")
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

export const StoredDocumentSchema = Schema.Struct({
  id: Schema.String,
  corpusId: Schema.String,
  sourceType: Schema.String,
  sourceId: Schema.String,
  sourcePath: Schema.String,
  kind: MediaKindSchema,
  title: Schema.String,
  sourceUrl: Schema.NullOr(Schema.String),
  contentHash: Schema.String,
  embeddingModel: Schema.String,
  embeddingDim: Schema.Number,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  chunkCount: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const DeleteDocumentResponseSchema = Schema.Struct({
  documentId: Schema.String,
  deleted: Schema.Boolean
})

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
  .setUrlParams(Schema.Struct({ corpus: Schema.optional(Schema.String) }))
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
  .setUrlParams(
    Schema.Struct({
      filename: Schema.String,
      corpus: Schema.optional(Schema.String),
      sourceType: Schema.optional(Schema.String),
      sourceId: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
      sourceUrl: Schema.optional(Schema.String)
    })
  )
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
      k: Schema.optionalWith(Schema.NumberFromString, { default: () => 5 }),
      corpus: Schema.optional(Schema.String),
      documentIds: Schema.optional(Schema.String)
    })
  )
  .addSuccess(Schema.Array(SearchHitSchema))
  .addError(ApiUpstreamFailed, { status: 502 })
  .addError(ApiStoreFailed, { status: 500 })

const status = HttpApiEndpoint.get("status", "/status")
  .setUrlParams(Schema.Struct({ corpus: Schema.optional(Schema.String) }))
  .addSuccess(StatusSchema)
  .addError(ApiStoreFailed, { status: 500 })

const documents = HttpApiEndpoint.get("documents", "/documents")
  .setUrlParams(Schema.Struct({ corpus: Schema.optional(Schema.String) }))
  .addSuccess(Schema.Array(StoredDocumentSchema))
  .addError(ApiStoreFailed, { status: 500 })

const deleteDocument = HttpApiEndpoint.del("deleteDocument")`/documents/${HttpApiSchema.param("documentId", Schema.String)}`
  .addSuccess(DeleteDocumentResponseSchema)
  .addError(ApiStoreFailed, { status: 500 })

/**
 * The HTTP surface: ingest anything (multipart or raw bytes), search, status.
 * OpenAPI docs are derived from this definition (served at /docs in `serve`).
 */
export class UploadWorldApi extends HttpApi.make("upload-world").add(
  HttpApiGroup.make("pipeline")
    .add(ingest)
    .add(ingestRaw)
    .add(searchEndpoint)
    .add(status)
    .add(documents)
    .add(deleteDocument)
) {}
