import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { MessageIdSchema } from "@news-podcast/protocols"

import {
  ArchiveRequestIdSchema,
  ArticleIdSchema,
  Sha256Schema,
} from "../../domain/article.js"
import { FeedIdSchema } from "../../domain/subscription.js"
import {
  deriveArticleIdentityUnsafe,
  deriveManualArchiveRequestIdUnsafe,
} from "./identity.js"

describe("RSS item identities", () => {
  it("derives distinct stable UUIDs from feed and external ID", () => {
    const input = {
      feedId: Schema.decodeUnknownSync(FeedIdSchema)(
        "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"
      ),
      externalId: "entry-1",
      captureFingerprint: Schema.decodeUnknownSync(Sha256Schema)(
        "a".repeat(64)
      ),
    }
    const first = deriveArticleIdentityUnsafe(input)

    expect(deriveArticleIdentityUnsafe(input)).toEqual(first)
    expect(first.articleId).not.toBe(first.archiveRequestId)
    expect(() =>
      Schema.decodeUnknownSync(ArticleIdSchema)(first.articleId)
    ).not.toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ArchiveRequestIdSchema)(first.archiveRequestId)
    ).not.toThrow()
    expect(
      deriveArticleIdentityUnsafe({ ...input, externalId: "entry-2" })
    ).not.toEqual(first)

    const updated = deriveArticleIdentityUnsafe({
      ...input,
      captureFingerprint: Schema.decodeUnknownSync(Sha256Schema)(
        "b".repeat(64)
      ),
    })
    expect(updated.articleId).toBe(first.articleId)
    expect(updated.archiveRequestId).not.toBe(first.archiveRequestId)
  })

  it("keeps a manual retry idempotent but gives each explicit refresh a new intent", () => {
    const articleId = Schema.decodeUnknownSync(ArticleIdSchema)(
      "5af55f2e-ff0b-475c-866a-f2cff48c101d"
    )
    const firstInput = {
      articleId,
      messageId: Schema.decodeUnknownSync(MessageIdSchema)(
        "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4"
      ),
    } as const
    const first = deriveManualArchiveRequestIdUnsafe(firstInput)

    expect(deriveManualArchiveRequestIdUnsafe(firstInput)).toBe(first)
    expect(
      deriveManualArchiveRequestIdUnsafe({
        articleId,
        messageId: Schema.decodeUnknownSync(MessageIdSchema)(
          "ea122752-73d0-4851-9664-7d3e63e76859"
        ),
      })
    ).not.toBe(first)
    expect(() =>
      Schema.decodeUnknownSync(ArchiveRequestIdSchema)(first)
    ).not.toThrow()
  })
})
