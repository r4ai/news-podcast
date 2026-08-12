import { parse } from "@news-podcast/kernel"
import { Effect } from "effect"

import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
} from "../domain/article.js"
import { archiveArticle } from "../application/archive-article.js"
import type { ArchiveArticlePorts } from "../application/ports.js"

export const parseArchiveCommand = parse(ArchiveCommandSchema)
export const parseArchiveCapture = parse(ArchiveCaptureSchema)

/** Boundary composition: untrusted transport data cannot enter the use case unparsed. */
export const archiveArticleFromUnknown =
  (ports: ArchiveArticlePorts) => (input: unknown) =>
    parseArchiveCommand(input).pipe(
      Effect.flatMap((command) => archiveArticle(ports)(command))
    )
