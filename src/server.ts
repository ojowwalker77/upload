import { FileSystem, HttpApiBuilder, HttpApiSwagger, HttpServer } from "@effect/platform"
import { NodeContext, NodeHttpClient, NodeHttpServer } from "@effect/platform-node"
import { Effect, Either, Layer } from "effect"
import { createServer } from "node:http"
import {
  ApiProcessingFailed,
  ApiStoreFailed,
  ApiUnsupportedMedia,
  ApiUpstreamFailed,
  UploadWorldApi
} from "./api.js"
import type { GeminiError, ProcessingError, SearchHit, UnsupportedMediaError, VectorStoreError } from "./domain.js"
import { ingestData, search } from "./pipeline.js"
import { Ffmpeg } from "./services/Ffmpeg.js"
import { FfmpegLive } from "./services/FfmpegLive.js"
import { Gemini } from "./services/Gemini.js"
import { GeminiLive } from "./services/GeminiLive.js"
import { GeminiMock } from "./services/GeminiMock.js"
import { ProcessorLive } from "./services/ProcessorLive.js"
import { Transcriber } from "./services/Transcriber.js"
import { TranscriberGeminiLive } from "./services/TranscriberGemini.js"
import { TranscriberOpenAILive } from "./services/TranscriberOpenAI.js"
import { WhisperCppLive } from "./services/TranscriberWhisperCpp.js"
import { VectorStore } from "./services/VectorStore.js"
import { MemoryVectorStoreLive } from "./stores/memory.js"
import { SqliteVectorStoreLive } from "./stores/sqlite.js"

const toApiError = (
  e: GeminiError | ProcessingError | VectorStoreError | UnsupportedMediaError
): ApiUnsupportedMedia | ApiProcessingFailed | ApiUpstreamFailed | ApiStoreFailed => {
  switch (e._tag) {
    case "UnsupportedMediaError":
      return new ApiUnsupportedMedia({ path: e.path, detail: e.detail })
    case "ProcessingError":
      return new ApiProcessingFailed({ path: e.path, detail: e.detail })
    case "GeminiError":
      return new ApiUpstreamFailed({ detail: `${e.operation}: ${e.detail}` })
    case "VectorStoreError":
      return new ApiStoreFailed({ detail: `${e.operation}: ${e.detail}` })
  }
}

const toWireHit = (hit: SearchHit) => ({
  score: hit.score,
  id: hit.chunk.id,
  documentId: hit.chunk.documentId,
  sourcePath: hit.chunk.sourcePath,
  kind: hit.chunk.kind,
  index: hit.chunk.index,
  text: hit.chunk.text,
  metadata: hit.chunk.metadata
})

/**
 * Handlers for the `UploadWorldApi` — require the pipeline services
 * (Gemini, Processor, VectorStore) plus FileSystem for multipart temp files.
 */
export const PipelineHandlersLive = HttpApiBuilder.group(UploadWorldApi, "pipeline", (handlers) =>
  handlers
    .handle("ingest", ({ payload }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const results: Array<{
          documentId: string
          path: string
          kind: "text" | "audio" | "video" | "image" | "pdf" | "mix"
          chunks: number
        }> = []
        const skipped: Array<{ path: string; reason: string }> = []

        for (const file of payload.files) {
          const outcome = yield* fs.readFile(file.path).pipe(
            Effect.mapError((e) => `failed to read upload: ${String(e)}`),
            Effect.flatMap((data) =>
              ingestData(file.name, data).pipe(Effect.mapError((e) => e.detail))
            ),
            Effect.either
          )
          if (Either.isLeft(outcome)) skipped.push({ path: file.name, reason: outcome.left })
          else results.push(outcome.right)
        }

        return { results, skipped }
      })
    )
    .handle("ingestRaw", ({ payload, urlParams }) =>
      ingestData(urlParams.filename, payload).pipe(Effect.mapError(toApiError))
    )
    .handle("search", ({ urlParams }) =>
      search(urlParams.q, urlParams.k).pipe(
        Effect.map((hits) => hits.map(toWireHit)),
        Effect.mapError((e) =>
          e._tag === "GeminiError"
            ? new ApiUpstreamFailed({ detail: `${e.operation}: ${e.detail}` })
            : new ApiStoreFailed({ detail: `${e.operation}: ${e.detail}` })
        )
      )
    )
    .handle("status", () =>
      Effect.gen(function* () {
        const store = yield* VectorStore
        const chunks = yield* store.count
        return { chunks }
      }).pipe(
        Effect.mapError((e) => new ApiStoreFailed({ detail: `${e.operation}: ${e.detail}` }))
      )
    )
)

/** The full API as a Layer — merge this into an existing Effect HTTP server. */
export const UploadWorldApiLive = HttpApiBuilder.api(UploadWorldApi).pipe(
  Layer.provide(PipelineHandlersLive)
)

// ─── Turn-key wiring ─────────────────────────────────────────────────────────

export type TranscriberKind = "whisper" | "openai" | "gemini"

export interface AppConfig {
  /** Bring your own Gemini implementation (overrides `mock`). */
  readonly gemini?: Layer.Layer<Gemini, unknown, never>
  /** Bring your own vector store (overrides `store`/`db`). */
  readonly vectorStore?: Layer.Layer<VectorStore, unknown, never>
  /** Bring your own media conditioner (default: real ffmpeg binary). */
  readonly ffmpeg?: Layer.Layer<Ffmpeg, unknown, never>
  /** Bring your own speech-to-text (overrides `transcriber`). */
  readonly transcriberLayer?: Layer.Layer<Transcriber, unknown, never>
  /** whisper = local whisper.cpp (default) · openai = Whisper API · gemini = Gemini native */
  readonly transcriber?: TranscriberKind
  readonly store?: "sqlite" | "memory"
  readonly db?: string
  readonly mock?: boolean
}

/** Everything the handlers need, from a simple config. */
export const appLayer = (config: AppConfig = {}) => {
  const hasKey = (process.env["GEMINI_API_KEY"] ?? "").trim().length > 0
  const useMock = config.mock === true || !hasKey
  const gemini =
    config.gemini ?? (useMock ? GeminiMock : GeminiLive.pipe(Layer.provide(NodeHttpClient.layer)))
  const vectorStore =
    config.vectorStore ??
    (config.store === "memory"
      ? MemoryVectorStoreLive
      : SqliteVectorStoreLive(config.db ?? "./upload-world.db"))
  // ffmpeg conditioning is mandatory and key-free: always the real binary
  // unless the embedder explicitly injects something else.
  const ffmpeg = config.ffmpeg ?? FfmpegLive.pipe(Layer.provide(NodeContext.layer))
  const transcriber =
    config.transcriberLayer ??
    (() => {
      // keyless/mock runs default to the (mocked) Gemini transcriber so the
      // demo works with no whisper binary or model download
      switch (config.transcriber ?? (useMock ? "gemini" : "whisper")) {
        case "whisper":
          return WhisperCppLive.pipe(Layer.provide(NodeContext.layer))
        case "openai":
          return TranscriberOpenAILive.pipe(Layer.provide(NodeHttpClient.layer))
        case "gemini":
          return TranscriberGeminiLive.pipe(Layer.provide(gemini))
      }
    })()
  return Layer.mergeAll(
    gemini,
    ProcessorLive.pipe(Layer.provide(Layer.mergeAll(gemini, ffmpeg, transcriber))),
    vectorStore,
    NodeContext.layer
  )
}

/**
 * Web-standard `(Request) => Promise<Response>` handler — mount it in
 * anything that speaks fetch: Express/Hono/Fastify/Next.js/Bun/Deno.
 * Call `dispose` on shutdown to release the store.
 */
export const makeWebHandler = (
  config: AppConfig = {}
): { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> } => {
  const { dispose, handler } = HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      UploadWorldApiLive.pipe(Layer.provide(appLayer(config))),
      NodeHttpServer.layerContext
    )
  )
  return { handler: (request) => handler(request), dispose }
}

/**
 * Standalone server Layer (Node http) with OpenAPI docs at /docs.
 * `Layer.launch(serverLayer({ port: 3000 }))` and you're live.
 */
export const serverLayer = (config: AppConfig & { readonly port: number }) =>
  HttpApiBuilder.serve().pipe(
    Layer.provide(HttpApiSwagger.layer({ path: "/docs" })),
    Layer.provide(UploadWorldApiLive),
    Layer.provide(appLayer(config)),
    HttpServer.withLogAddress,
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port: config.port }))
  )
