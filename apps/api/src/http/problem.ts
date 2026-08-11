import type { Context } from "hono"

/** RFC 7807 Problem Details。`http/schemas.ts` の ProblemSchema と対応する。 */
export interface Problem {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly code: string
}

/** RFC 7807 Problem Details オブジェクトを組み立てる。 */
export function problem(status: number, code: string, title: string): Problem {
  return {
    type: `https://news-podcast.example/problems/${code}`,
    title,
    status,
    code,
  }
}

/**
 * 依存の欠落・未構築による縮退を表す 503 レスポンス。
 * Cloudflare Workers エントリは中核依存を構築しないため、全 /v1 ルートがこれを返しうる。
 */
export function unavailable(context: Context) {
  return context.json(
    problem(503, "service-unavailable", "Service unavailable"),
    503
  )
}

/** 所有者スコープ外・未存在リソースに対する共通の 404 応答。 */
export function notFound(context: Context) {
  return context.json(problem(404, "not-found", "Not found"), 404)
}
