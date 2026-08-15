import { deepFreeze } from "@news-podcast/kernel"

/**
 * 上流のRPC応答をHTTPの問題詳細へ落とし込むための語彙。
 * 境界の外へ上流固有の理由を漏らさないよう、ここだけが問題を生成する。
 */

export const unavailable = () =>
  deepFreeze({
    type: "about:blank",
    title: "Upstream unavailable",
    status: 503 as const,
    code: "upstream_unavailable",
  })

export const unauthorized = () =>
  deepFreeze({
    type: "about:blank",
    title: "Authentication required",
    status: 401 as const,
    code: "authentication_required",
  })

export const conflict = () =>
  deepFreeze({
    type: "about:blank",
    title: "Idempotency conflict",
    status: 409 as const,
    code: "idempotency_conflict",
  })

export const notFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Episode not found",
    status: 404 as const,
    code: "episode_not_found",
  })

export const badRequest = () =>
  deepFreeze({
    type: "about:blank",
    title: "Invalid subscription request",
    status: 400 as const,
    code: "invalid_subscription_request",
  })

export const unprocessable = () =>
  deepFreeze({
    type: "about:blank",
    title: "Feed subscription rejected",
    status: 422 as const,
    code: "feed_subscription_rejected",
  })

export const subscriptionNotFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Feed subscription not found",
    status: 404 as const,
    code: "feed_subscription_not_found",
  })

export const resourceNotFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Resource not found",
    status: 404 as const,
    code: "resource_not_found",
  })

export const resourceConflict = () =>
  deepFreeze({
    type: "about:blank",
    title: "Resource conflict",
    status: 409 as const,
    code: "resource_conflict",
  })

export const articleNotFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Article not found",
    status: 404 as const,
    code: "article_not_found",
  })

export const jobNotFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Episode job not found",
    status: 404 as const,
    code: "episode_job_not_found",
  })

export const jobConflict = (code: string) =>
  deepFreeze({
    type: "about:blank",
    title: "Episode job state conflict",
    status: 409 as const,
    code: code.toLowerCase(),
  })

/**
 * すでに問題詳細へ翻訳済みの失敗はそのまま通し、それ以外だけを503へ畳む。
 * 末尾の`mapError`が404や409を握り潰さないようにするための境界。
 */
// oxlint-disable-next-line no-explicit-any -- 各ポートの宣言済み失敗型をそのまま保つ
export const normalizeProblem = (failure: unknown): any =>
  typeof failure === "object" && failure !== null && "status" in failure
    ? failure
    : unavailable()
