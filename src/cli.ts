#!/usr/bin/env node
import { Args, Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import { ingestPaths, search } from "./pipeline.js"
import { appLayer as makeAppLayer, serverLayer } from "./server.js"
import { VectorStore } from "./services/VectorStore.js"

// ─── Shared options ──────────────────────────────────────────────────────────

const storeOption = Options.choice("store", ["sqlite", "memory"]).pipe(
  Options.withDefault("sqlite" as const),
  Options.withDescription("vector store backend")
)

const dbOption = Options.text("db").pipe(
  Options.withDefault("./upload-world.db"),
  Options.withDescription("sqlite database path")
)

const mockOption = Options.boolean("mock").pipe(
  Options.withDescription("force the deterministic offline Gemini layer")
)

const transcriberOption = Options.choice("transcriber", ["whisper", "openai", "gemini"]).pipe(
  Options.withDefault("whisper" as const),
  Options.withDescription("speech-to-text backend for audio/video")
)

interface StoreConfig {
  readonly store: "sqlite" | "memory"
  readonly db: string
  readonly mock: boolean
  readonly transcriber?: "whisper" | "openai" | "gemini"
}

const appLayer = (config: StoreConfig) => {
  const hasKey = (process.env["GEMINI_API_KEY"] ?? "").trim().length > 0
  const note =
    !config.mock && !hasKey
      ? Console.error("note: GEMINI_API_KEY is not set — using the deterministic mock Gemini layer")
      : Effect.void
  return { layer: makeAppLayer(config), note }
}

// ─── ingest ──────────────────────────────────────────────────────────────────

const ingestCommand = Command.make(
  "ingest",
  {
    paths: Args.text({ name: "path" }).pipe(
      Args.withDescription("files or directories to ingest"),
      Args.atLeast(1)
    ),
    store: storeOption,
    db: dbOption,
    mock: mockOption,
    transcriber: transcriberOption
  },
  ({ db, mock, paths, store, transcriber }) => {
    const app = appLayer({ store, db, mock, transcriber })
    return Effect.gen(function* () {
      yield* app.note
      const report = yield* ingestPaths(paths)
      for (const r of report.results) {
        yield* Console.log(`  ✓ ${r.path}  [${r.kind}]  ${r.chunks} chunks  (doc ${r.documentId})`)
      }
      for (const s of report.skipped) {
        yield* Console.log(`  – skipped ${s.path}: ${s.reason}`)
      }
      const total = report.results.reduce((n, r) => n + r.chunks, 0)
      yield* Console.log(
        `Ingested ${report.results.length} files, ${total} chunks (skipped ${report.skipped.length})`
      )
    }).pipe(Effect.provide(app.layer))
  }
).pipe(Command.withDescription("normalize files to text, embed, and store"))

// ─── search ──────────────────────────────────────────────────────────────────

const searchCommand = Command.make(
  "search",
  {
    query: Args.text({ name: "query" }).pipe(Args.withDescription("natural-language query")),
    k: Options.integer("limit").pipe(
      Options.withAlias("k"),
      Options.withDefault(5),
      Options.withDescription("results to return")
    ),
    store: storeOption,
    db: dbOption,
    mock: mockOption
  },
  ({ db, k, mock, query, store }) => {
    const app = appLayer({ store, db, mock })
    return Effect.gen(function* () {
      yield* app.note
      const hits = yield* search(query, k)
      if (hits.length === 0) {
        yield* Console.log("no results — ingest something first?")
        return
      }
      for (const [i, hit] of hits.entries()) {
        const snippet = hit.chunk.text.replace(/\s+/g, " ").slice(0, 200)
        yield* Console.log(
          `${i + 1}. ${hit.score.toFixed(3)}  ${hit.chunk.sourcePath}  [${hit.chunk.kind}]\n   ${snippet}`
        )
      }
    }).pipe(Effect.provide(app.layer))
  }
).pipe(Command.withDescription("semantic search over ingested content"))

// ─── status ──────────────────────────────────────────────────────────────────

const statusCommand = Command.make(
  "status",
  { store: storeOption, db: dbOption },
  ({ db, store }) => {
    const app = appLayer({ store, db, mock: true })
    return Effect.gen(function* () {
      const vectorStore = yield* VectorStore
      const n = yield* vectorStore.count
      yield* Console.log(`${n} chunks stored (${store}${store === "sqlite" ? `: ${db}` : ""})`)
    }).pipe(Effect.provide(app.layer))
  }
).pipe(Command.withDescription("show stored chunk count"))

// ─── serve ───────────────────────────────────────────────────────────────────

const serveCommand = Command.make(
  "serve",
  {
    port: Options.integer("port").pipe(
      Options.withAlias("p"),
      Options.withDefault(3000),
      Options.withDescription("port to listen on")
    ),
    store: storeOption,
    db: dbOption,
    mock: mockOption,
    transcriber: transcriberOption
  },
  ({ db, mock, port, store, transcriber }) => {
    const app = appLayer({ store, db, mock, transcriber })
    return Effect.gen(function* () {
      yield* app.note
      yield* Console.log(
        `upload-world API on http://localhost:${port} — OpenAPI docs at http://localhost:${port}/docs`
      )
      yield* Layer.launch(serverLayer({ port, store, db, mock, transcriber }))
    })
  }
).pipe(Command.withDescription("serve the HTTP API (multipart + raw ingest, search, status)"))

// ─── root ────────────────────────────────────────────────────────────────────

const root = Command.make("upload-world").pipe(
  Command.withDescription("multimodal ingest → Gemini embeddings → pluggable vector store"),
  Command.withSubcommands([ingestCommand, searchCommand, statusCommand, serveCommand])
)

const cli = Command.run(root, { name: "upload-world", version: "0.1.0" })

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain)
