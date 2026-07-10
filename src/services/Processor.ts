import { Context } from "effect"
import type { Effect } from "effect"
import type { Chunk, GeminiError, IngestSource, ProcessingError } from "../domain.js"

/**
 * Normalizes one source into text chunks, per the diagram:
 *   text  → describe/summarize + chunk the raw text
 *   audio → transcript
 *   video → description of scenes/key moments
 *   image → description
 *   pdf   → extracted text and tables
 *   mix   → route parts → combine
 * Implementations depend on Gemini; swap the Layer to change providers.
 */
export interface ProcessorService {
  readonly process: (
    source: IngestSource
  ) => Effect.Effect<ReadonlyArray<Chunk>, ProcessingError | GeminiError>
}

export class Processor extends Context.Tag("upload-world/Processor")<
  Processor,
  ProcessorService
>() {}
