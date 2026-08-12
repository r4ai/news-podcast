import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ArchiveRequestIdSchema,
  ArticleIdSchema,
} from "../../domain/article.js"
import { FeedIdSchema } from "../../domain/subscription.js"
import { deriveArticleIdentityUnsafe } from "./identity.js"

describe("RSS item identities", () => {
  it("derives distinct stable UUIDs from feed and external ID", () => {
    const input = {
      feedId: Schema.decodeUnknownSync(FeedIdSchema)(
        "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"
      ),
      externalId: "entry-1",
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
  })
})
