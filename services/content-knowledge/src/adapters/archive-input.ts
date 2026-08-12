import { deepFreeze, parse } from "@news-podcast/kernel"
import { messageEnvelope } from "@news-podcast/protocols"
import { Effect } from "effect"

import { archiveArticle } from "../application/archive-article.js"
import type { ArchiveArticlePorts } from "../application/ports.js"
import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
} from "../domain/article.js"

export const parseArchiveCommand = parse(ArchiveCommandSchema)
export const parseArchiveCapture = parse(ArchiveCaptureSchema)
export const ArchiveCommandEnvelopeSchema =
  messageEnvelope(ArchiveCommandSchema)
export const parseArchiveCommandEnvelope = parse(ArchiveCommandEnvelopeSchema)

/** Boundary composition: untrusted transport data cannot enter the use case unparsed. */
export const archiveArticleFromUnknown =
  (ports: ArchiveArticlePorts) => (input: unknown) =>
    parseArchiveCommandEnvelope(input).pipe(
      Effect.flatMap((envelope) =>
        archiveArticle(ports)(
          deepFreeze({
            command: envelope.payload,
            context: {
              messageId: envelope.messageId,
              correlationId: envelope.correlationId,
              traceparent: envelope.traceparent,
              actor: envelope.actor,
            },
          })
        )
      )
    )
