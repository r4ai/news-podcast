import { describe, expect, it } from "vitest"

import { describeError } from "./error-message"

describe("describeError", () => {
  it("回線断は原因が手元にあることを言う。`Failed to fetch`は出さない", () => {
    // `fetch`が拒否するのは回線側の失敗だけで、そのときは必ず`TypeError`。
    const message = describeError(new TypeError("Failed to fetch"))

    expect(message).toContain("ネットワーク")
    expect(message).not.toContain("fetch")
  })

  it("Problem Detailsは運用の文言ではなく、状態から言い換える", () => {
    const problem = {
      type: "about:blank",
      title: "Article not found",
      status: 404,
      code: "article_not_found",
    }

    expect(describeError(problem)).toBe("対象が見つかりませんでした。")
    expect(describeError(problem)).not.toContain("Article")
  })

  it("競合と混雑は、待てば直ることを伝える", () => {
    expect(describeError({ status: 409 })).toContain("少し待ってから")
    expect(describeError({ status: 429 })).toContain("少し待ってから")
  })

  it("表に無い5xxはまとめてサーバ側の不調として扱う", () => {
    expect(describeError({ status: 502 })).toContain("サーバが応答")
    expect(describeError({ status: 503 })).toContain("サーバが応答")
  })

  it("素性の判らない失敗は、断定せずに済ませる", () => {
    expect(describeError(new Error("boom"))).toBe(
      "データを取得できませんでした"
    )
    expect(describeError({ status: "418" })).toBe(
      "データを取得できませんでした"
    )
    expect(describeError(undefined)).toBe("データを取得できませんでした")
  })
})
