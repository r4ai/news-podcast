import { Schema } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"

import {
  BadRequestProblemSchema,
  ConflictProblemSchema,
  NotFoundProblemSchema,
  UnauthorizedProblemSchema,
  UnavailableProblemSchema,
  UnprocessableProblemSchema,
} from "../../contract.js"
import {
  articleNotFound,
  badRequest,
  conflict,
  jobConflict,
  jobNotFound,
  normalizeProblem,
  notFound,
  resourceConflict,
  resourceNotFound,
  subscriptionNotFound,
  unauthorized,
  unavailable,
  unprocessable,
} from "./problems.js"

describe("Gateway HTTP Problem contract", () => {
  it.each([
    [
      "bad request",
      badRequest(),
      400,
      "invalid_subscription_request",
      BadRequestProblemSchema,
    ],
    [
      "unauthorized",
      unauthorized(),
      401,
      "authentication_required",
      UnauthorizedProblemSchema,
    ],
    [
      "episode not found",
      notFound(),
      404,
      "episode_not_found",
      NotFoundProblemSchema,
    ],
    [
      "subscription not found",
      subscriptionNotFound(),
      404,
      "feed_subscription_not_found",
      NotFoundProblemSchema,
    ],
    [
      "resource not found",
      resourceNotFound(),
      404,
      "resource_not_found",
      NotFoundProblemSchema,
    ],
    [
      "article not found",
      articleNotFound(),
      404,
      "article_not_found",
      NotFoundProblemSchema,
    ],
    [
      "job not found",
      jobNotFound(),
      404,
      "episode_job_not_found",
      NotFoundProblemSchema,
    ],
    [
      "conflict",
      conflict(),
      409,
      "idempotency_conflict",
      ConflictProblemSchema,
    ],
    [
      "resource conflict",
      resourceConflict(),
      409,
      "resource_conflict",
      ConflictProblemSchema,
    ],
    [
      "terminal job conflict",
      jobConflict("JOB_TERMINAL"),
      409,
      "job_terminal",
      ConflictProblemSchema,
    ],
    [
      "retry job conflict",
      jobConflict("JOB_NOT_FAILED"),
      409,
      "job_not_failed",
      ConflictProblemSchema,
    ],
    [
      "unprocessable",
      unprocessable(),
      422,
      "feed_subscription_rejected",
      UnprocessableProblemSchema,
    ],
    [
      "unavailable",
      unavailable(),
      503,
      "upstream_unavailable",
      UnavailableProblemSchema,
    ],
  ] as const)(
    "keeps the typed %s mapping aligned with OpenAPI",
    (_, problem, status, code, schema) => {
      expect(problem).toMatchObject({ status, code })
      expect(Schema.is(schema)(problem)).toBe(true)
      expect(normalizeProblem(problem)).toEqual(problem)
      expect(Object.isFrozen(normalizeProblem(problem))).toBe(true)
    }
  )

  it("fails closed instead of reflecting a status-shaped internal failure", () => {
    const internalFailure = {
      status: 404,
      title: "SQLITE_ERROR",
      code: "raw_internal_error",
      detail: "secret-token",
    }

    expect(normalizeProblem(internalFailure)).toEqual(unavailable())
    expect(JSON.stringify(normalizeProblem(internalFailure))).not.toContain(
      "secret-token"
    )
  })

  it("rejects an otherwise public Problem carrying an internal detail", () => {
    const internalFailure = {
      ...unavailable(),
      detail: "database-password",
    }

    const normalized = normalizeProblem(internalFailure)
    expect(normalized).toEqual(unavailable())
    expect(JSON.stringify(normalized)).not.toContain("database-password")
  })

  it("rejects a Problem whose status, code, and title do not form a public variant", () => {
    expect(
      Schema.is(NotFoundProblemSchema)({
        type: "about:blank",
        title: "Upstream unavailable",
        status: 404,
        code: "upstream_unavailable",
      })
    ).toBe(false)
  })

  it("does not erase a translated failure to any", () => {
    expectTypeOf(normalizeProblem(notFound())).toEqualTypeOf<
      ReturnType<typeof notFound> | ReturnType<typeof unavailable>
    >()
  })
})
