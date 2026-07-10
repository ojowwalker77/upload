#!/usr/bin/env node
import { Args, Command, Options } from "@effect/cli"
import { NodeContext, NodeHttpClient, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import { ingestPaths, search } from "./pipeline.js"
import { Gemini } from "./services/Gemini.js"
import { GeminiLive } from "./services/GeminiLive.js"
import { GeminiMock } from "./services/GeminiMock.js"
import { Processor } from "./services/Processor.js"
import { ProcessorLive } from "./services/ProcessorLive.js"
import { VectorStore } from "./services/VectorStore.js"
import { MemoryVectorStoreLive } from "./stores/memory.js"
import { SqliteVectorStoreLive } from "./stores/sqlite.js"

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

interface StoreConfig {
  readonly store: "sqlite" | "memory"
  readonly db: string
  readonly mock: boolean
}

const appLayer = ({ db, mock, store }: StoreConfig) => {
  const hasKey = (process.env["GEMINI_API_KEY"] ?? "").trim().length > 0
  const useMock = mock || !hasKey
  const gemini = useMock ? GeminiMock : GeminiLive.pipe(Layer.provide(NodeHttpClient.layer))
  const vectorStore = store === "memory" ? MemoryVectorStoreLive : SqliteVectorStoreLive(db)
  const note =
    useMock && !mock
      ? Console.error("note: GEMINI_API_KEY is not set — using the deterministic mock Gemini layer")
      : Effect.void
  return {
    layer: Layer.mergeAll(gemini, ProcessorLive.pipe(Layer.provide(gemini)), vectorStore),
    note
  }
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
    mock: mockOption
  },
  ({ db, mock, paths, store }) => {
    const app = appLayer({ store, db, mock })
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

// ─── root ────────────────────────────────────────────────────────────────────

const root = Command.make("upload-world").pipe(
  Command.withDescription("multimodal ingest → Gemini embeddings → pluggable vector store"),
  Command.withSubcommands([ingestCommand, searchCommand, statusCommand])
)

const cli = Command.run(root, { name: "upload-world", version: "0.1.0" })

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain)
