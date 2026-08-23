import { ArticleLibraryReplySchema, subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { makeNatsGatewayPorts } from "../nats-gateway-ports.js"
import { ArticleIdSchema, SnapshotIdSchema } from "../../contract.js"
import {
  type CapturedRequest,
  dependencies,
  encodedReply,
  fakeClient,
  sessionHeaders,
  userSessionReply,
} from "./port-test-harness.js"

const articleId = Schema.decodeUnknownSync(ArticleIdSchema)(
  "5af55f2e-ff0b-475c-866a-f2cff48c101d"
)
const snapshotId = Schema.decodeUnknownSync(SnapshotIdSchema)(
  "6518412b-ce2f-4641-9f2c-a02dd515bc31"
)
const article = {
  articleId,
  feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
  title: "Fixed v1",
  sourceUrl: "https://example.com/v1",
  publishedAt: null,
  discoveredAt: "2026-08-12T00:00:00.000Z",
  archiveStatus: "Succeeded",
  snapshotId,
  state: {
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    hiddenAt: null,
  },
} as const

describe("NATS GatewayPorts exact article snapshot reads", () => {
  it("binds metadata and Markdown RPC commands to article and snapshot", async () => {
    const requests: CapturedRequest[] = []
    const ports = makeNatsGatewayPorts(
      fakeClient(async (request) => {
        if (request.subject === subjects.identity.resolveSession) {
          return userSessionReply(request)
        }
        requests.push(request)
        const payload = request.envelope.payload as { operation: string }
        return encodedReply(
          request.envelope,
          "content-knowledge",
          ArticleLibraryReplySchema,
          payload.operation === "FindSnapshot"
            ? { _tag: "Found", article }
            : { _tag: "Markdown", markdown: "# Fixed v1" }
        )
      }),
      dependencies()
    )

    await expect(
      Effect.runPromise(
        ports.getArticleSnapshot({
          headers: sessionHeaders,
          articleId,
          snapshotId,
        })
      )
    ).resolves.toMatchObject({ title: "Fixed v1", snapshotId })
    await expect(
      Effect.runPromise(
        ports.getArticleSnapshotMarkdown({
          headers: sessionHeaders,
          articleId,
          snapshotId,
        })
      )
    ).resolves.toEqual({ markdown: "# Fixed v1" })

    expect(requests.map((request) => request.envelope.payload)).toEqual([
      { operation: "FindSnapshot", articleId, snapshotId },
      { operation: "SnapshotMarkdown", articleId, snapshotId },
    ])
  })
})
