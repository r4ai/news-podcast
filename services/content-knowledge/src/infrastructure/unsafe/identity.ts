import { randomUUID } from "node:crypto"

import type { MessageId } from "@news-podcast/protocols"

import type { CapturedAt } from "../../domain/article.js"

/** Platform guarantees UUID v4 and ISO UTC output; casts remain confined to unsafe. */
export const randomMessageIdUnsafe = (): MessageId => randomUUID() as MessageId

export const currentCapturedAtUnsafe = (): CapturedAt =>
  new Date().toISOString() as CapturedAt
