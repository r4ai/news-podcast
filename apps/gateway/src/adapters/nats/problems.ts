import { deepFreeze } from "@news-podcast/kernel"
import type { EpisodeJobControlReply } from "@news-podcast/protocols"
import { Schema } from "effect"

import { HttpProblemSchema, type HttpProblem } from "../../contract.js"

/**
 * 上流のRPC応答をHTTPの問題詳細へ落とし込むための語彙。
 * 境界の外へ上流固有の理由を漏らさないよう、ここだけが問題を生成する。
 */

type ProblemCode = HttpProblem["code"]
type ProblemFor<Code extends ProblemCode> = Extract<HttpProblem, { code: Code }>
type ProblemSpecs = {
  readonly [Code in ProblemCode]: Pick<ProblemFor<Code>, "status" | "title">
}

/** OpenAPI unionを実装側のstatus/title表へ全件対応させる。 */
const problemSpecs = {
  invalid_subscription_request: {
    status: 400,
    title: "Invalid subscription request",
  },
  authentication_required: {
    status: 401,
    title: "Authentication required",
  },
  operation_forbidden: { status: 403, title: "Operation forbidden" },
  episode_not_found: { status: 404, title: "Episode not found" },
  feed_subscription_not_found: {
    status: 404,
    title: "Feed subscription not found",
  },
  resource_not_found: { status: 404, title: "Resource not found" },
  article_not_found: { status: 404, title: "Article not found" },
  episode_job_not_found: {
    status: 404,
    title: "Episode job not found",
  },
  idempotency_conflict: { status: 409, title: "Idempotency conflict" },
  resource_conflict: { status: 409, title: "Resource conflict" },
  feed_subscription_exists: {
    status: 409,
    title: "Feed subscription already exists",
  },
  job_terminal: { status: 409, title: "Episode job state conflict" },
  job_not_failed: { status: 409, title: "Episode job state conflict" },
  feed_subscription_rejected: {
    status: 422,
    title: "Feed subscription rejected",
  },
  upstream_unavailable: { status: 503, title: "Upstream unavailable" },
} as const satisfies ProblemSpecs

const problem = <Code extends ProblemCode>(code: Code): ProblemFor<Code> =>
  deepFreeze({
    type: "about:blank" as const,
    ...problemSpecs[code],
    code,
  }) as unknown as ProblemFor<Code>

export const unavailable = () => problem("upstream_unavailable")
export const unauthorized = () => problem("authentication_required")
export const forbidden = () => problem("operation_forbidden")
export const conflict = () => problem("idempotency_conflict")
export const notFound = () => problem("episode_not_found")
export const badRequest = () => problem("invalid_subscription_request")
export const unprocessable = () => problem("feed_subscription_rejected")
export const subscriptionNotFound = () => problem("feed_subscription_not_found")
export const resourceNotFound = () => problem("resource_not_found")
export const resourceConflict = () => problem("resource_conflict")
export const subscriptionExists = () => problem("feed_subscription_exists")
export const articleNotFound = () => problem("article_not_found")
export const jobNotFound = () => problem("episode_job_not_found")

type JobConflictCode = Extract<
  EpisodeJobControlReply,
  { readonly _tag: "Conflict" }
>["code"]
const jobConflictCode = {
  JOB_TERMINAL: "job_terminal",
  JOB_NOT_FAILED: "job_not_failed",
} as const satisfies Readonly<
  Record<
    JobConflictCode,
    Extract<HttpProblem, { title: "Episode job state conflict" }>["code"]
  >
>

export const jobConflict = (code: JobConflictCode) =>
  problem(jobConflictCode[code])

const decodeHttpProblem = Schema.decodeUnknownSync(HttpProblemSchema, {
  errors: "all",
  onExcessProperty: "error",
})

type NormalizedProblem<Failure> =
  | Extract<Failure, HttpProblem>
  | ReturnType<typeof unavailable>

/**
 * 翻訳済みの公開Problemだけを透過し、未知の失敗はredacted 503へ畳む。
 * Extractにより、各contextが宣言した4xx unionを消去しない。
 */
export const normalizeProblem = <Failure>(
  failure: Failure
): NormalizedProblem<Failure> => {
  try {
    return deepFreeze(decodeHttpProblem(failure)) as NormalizedProblem<Failure>
  } catch {
    return unavailable() as NormalizedProblem<Failure>
  }
}
