import { FileSystem } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, Either, Option } from "effect"
import { createHash } from "node:crypto"
import { basename } from "node:path"
import { DEFAULT_CORPUS_ID, EmbedderError, VectorStoreError } from "./domain.js"
import type {
  DocumentDescriptor,
  DocumentMetadata,
  EmbeddedChunk,
  GeminiError,
  MediaKind,
  ProcessingError,
  SearchFilter,
  SearchHit,
  StoredDocument,
  UnsupportedMediaError
} from "./domain.js"
import { detectMedia } from "./services/Router.js"
import { Embedder } from "./services/Embedder.js"
import { Processor } from "./services/Processor.js"
import { VectorStore } from "./services/VectorStore.js"

export interface IngestResult {
  readonly documentId: string
  readonly corpusId: string
  readonly sourceType: string
  readonly sourceId: string
  readonly path: string
  readonly kind: MediaKind
  readonly chunks: number
  readonly status: "inserted" | "updated" | "unchanged"
}

export interface IngestReport {
  readonly results: ReadonlyArray<IngestResult>
  readonly skipped: ReadonlyArray<{ readonly path: string; readonly reason: string }>
}

export interface IngestOptions {
  readonly corpusId?: string
  readonly sourceType?: string
  readonly sourceId?: string
  readonly title?: string
  readonly sourceUrl?: string | null
  readonly metadata?: DocumentMetadata
}

/** Stable across content updates; scoped by corpus and external source identity. */
export const documentIdFor = (corpusId: string, sourceType: string, sourceId: string): string =>
  createHash("sha256")
    .update(JSON.stringify([corpusId, sourceType, sourceId]))
    .digest("hex")
    .slice(0, 24)

const contentHashOf = (
  texts: ReadonlyArray<string>,
  embeddingModel: string
): string => {
  const hash = createHash("sha256")
  hash.update(embeddingModel)
  for (const text of texts) {
    hash.update("\u0000")
    hash.update(text)
  }
  return hash.digest("hex")
}

const canonicalJson = (value: unknown): string => {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize)
    if (typeof input !== "object" || input === null) return input
    return Object.fromEntries(
      Object.entries(input)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    )
  }
  return JSON.stringify(canonicalize(value))
}

const metadataMatches = (left: DocumentMetadata, right: DocumentMetadata): boolean =>
  canonicalJson(left) === canonicalJson(right)

/**
 * Ingest raw bytes under a (file)name — the name only drives modality routing
 * and provenance metadata, so this works for uploads that never touch disk.
 */
export const ingestData = (
  path: string,
  data: Uint8Array,
  options: IngestOptions = {}
): Effect.Effect<
  IngestResult,
  GeminiError | EmbedderError | ProcessingError | VectorStoreError | UnsupportedMediaError,
  Embedder | Processor | VectorStore
> =>
  Effect.gen(function* () {
    const processor = yield* Processor
    const embedder = yield* Embedder
    const store = yield* VectorStore

    const media = yield* detectMedia(path)
    const chunks = yield* processor.process({ path, data, ...media })
    const corpusId = options.corpusId ?? DEFAULT_CORPUS_ID
    const sourceType = options.sourceType ?? "file"
    const sourceId = options.sourceId ?? path
    const documentId = documentIdFor(corpusId, sourceType, sourceId)
    const descriptor: DocumentDescriptor = {
      id: documentId,
      corpusId,
      sourceType,
      sourceId,
      sourcePath: path,
      kind: media.kind,
      title: (options.title ?? basename(path)) || path,
      sourceUrl: options.sourceUrl ?? null,
      contentHash: contentHashOf(chunks.map((chunk) => chunk.text), embedder.info.model),
      embeddingModel: embedder.info.model,
      embeddingDim: embedder.info.dim,
      metadata: options.metadata ?? {}
    }

    const existing = yield* store.getDocument(documentId)
    if (
      Option.isSome(existing) &&
      existing.value.contentHash === descriptor.contentHash &&
      existing.value.sourcePath === descriptor.sourcePath &&
      existing.value.title === descriptor.title &&
      existing.value.sourceUrl === descriptor.sourceUrl &&
      metadataMatches(existing.value.metadata, descriptor.metadata)
    ) {
      return {
        documentId,
        corpusId,
        sourceType,
        sourceId,
        path,
        kind: media.kind,
        chunks: existing.value.chunkCount,
        status: "unchanged" as const
      }
    }

    const vectors = yield* embedder.embed(chunks.map((c) => c.text), "document")
    if (vectors.length !== chunks.length) {
      return yield* Effect.fail(
        new EmbedderError({
          model: embedder.info.model,
          detail: `expected ${chunks.length} embeddings, got ${vectors.length}`
        })
      )
    }
    const embedded: Array<EmbeddedChunk> = chunks.map((chunk, i) => ({
      ...chunk,
      id: `${documentId}:${chunk.index}`,
      documentId,
      metadata: {
        ...chunk.metadata,
        corpusId,
        sourceType,
        sourceId,
        title: descriptor.title,
        ...(descriptor.sourceUrl === null ? {} : { sourceUrl: descriptor.sourceUrl }),
        contentHash: descriptor.contentHash,
        embeddingModel: embedder.info.model
      },
      embedding: vectors[i] ?? []
    }))
    const status = yield* store.replaceDocument(descriptor, embedded)

    return {
      documentId,
      corpusId,
      sourceType,
      sourceId,
      path,
      kind: media.kind,
      chunks: embedded.length,
      status
    }
  })

/** Ingest one file from disk: read → route → normalize → embed → store. */
export const ingestPath = (
  path: string,
  options: IngestOptions = {}
): Effect.Effect<
  IngestResult,
  PlatformError | GeminiError | EmbedderError | ProcessingError | VectorStoreError | UnsupportedMediaError,
  FileSystem.FileSystem | Embedder | Processor | VectorStore
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const data = yield* fs.readFile(path)
    return yield* ingestData(path, data, options)
  })

const collectFiles = (
  root: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(root)
    if (info.type !== "Directory") return [root]

    const out: Array<string> = []
    const walk = (dir: string): Effect.Effect<void, PlatformError> =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectory(dir)
        for (const name of entries) {
          if (name.startsWith(".")) continue
          const full = `${dir}/${name}`
          const stat = yield* fs.stat(full)
          if (stat.type === "Directory") yield* walk(full)
          else if (stat.type === "File") out.push(full)
        }
      })
    yield* walk(root)
    return out
  })

/**
 * Ingest files and directories (recursed). Unsupported and unreadable inputs
 * are reported in `skipped` rather than failing the batch.
 */
export const ingestPaths = (
  paths: ReadonlyArray<string>,
  options: IngestOptions = {}
): Effect.Effect<
  IngestReport,
  PlatformError,
  FileSystem.FileSystem | Embedder | Processor | VectorStore
> =>
  Effect.gen(function* () {
    const candidates: Array<string> = []
    const skipped: Array<{ path: string; reason: string }> = []

    for (const path of paths) {
      const files = yield* collectFiles(path).pipe(Effect.either)
      if (Either.isLeft(files)) {
        skipped.push({ path, reason: String(files.left) })
      } else {
        candidates.push(...files.right)
      }
    }

    const supported: Array<string> = []
    for (const file of candidates) {
      const media = yield* detectMedia(file).pipe(Effect.either)
      if (Either.isLeft(media)) skipped.push({ path: file, reason: media.left.detail })
      else supported.push(file)
    }

    const outcomes = yield* Effect.forEach(
      supported,
      (file) =>
        ingestPath(file, {
          ...options,
          sourceId: options.sourceId === undefined || supported.length === 1
            ? options.sourceId ?? file
            : `${options.sourceId}:${file}`,
          ...(options.title !== undefined && supported.length === 1
            ? { title: options.title }
            : { title: basename(file) || file })
        }).pipe(Effect.either),
      { concurrency: 4 }
    )

    const results: Array<IngestResult> = []
    outcomes.forEach((outcome, i) => {
      const file = supported[i] ?? "unknown"
      if (Either.isLeft(outcome)) skipped.push({ path: file, reason: String(outcome.left) })
      else results.push(outcome.right)
    })

    return { results, skipped }
  })

/** Embed the query and return the k nearest chunks. */
export const search = (
  query: string,
  k: number,
  filter?: SearchFilter
): Effect.Effect<
  ReadonlyArray<SearchHit>,
  EmbedderError | VectorStoreError,
  Embedder | VectorStore
> =>
  Effect.gen(function* () {
    const embedder = yield* Embedder
    const store = yield* VectorStore

    // refuse to search across vector spaces — same dims, different model
    // would silently return garbage neighbors
    const meta = yield* store.meta
    if (Option.isSome(meta) && meta.value.model !== embedder.info.model) {
      return yield* Effect.fail(
        new VectorStoreError({
          operation: "search",
          detail: `store was embedded with "${meta.value.model}" but the current embedder is "${embedder.info.model}" — re-ingest, or switch back with --embedder`
        })
      )
    }

    const vectors = yield* embedder.embed([query], "query")
    return yield* store.search(vectors[0] ?? [], k, filter)
  })

/** List documents in a corpus without loading their chunk contents. */
export const listDocuments = (
  corpusId: string = DEFAULT_CORPUS_ID
): Effect.Effect<ReadonlyArray<StoredDocument>, VectorStoreError, VectorStore> =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    return yield* store.listDocuments(corpusId)
  })

/** Delete a document and every vector derived from it. */
export const deleteDocument = (
  documentId: string
): Effect.Effect<boolean, VectorStoreError, VectorStore> =>
  Effect.gen(function* () {
    const store = yield* VectorStore
    return yield* store.deleteDocument(documentId)
  })
