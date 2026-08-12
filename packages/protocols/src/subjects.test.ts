import { describe, expect, expectTypeOf, it } from "vitest"

import { subjects, type Subject } from "./subjects.js"

describe("versioned NATS subjects", () => {
  it("keeps the integration surface explicit and versioned", () => {
    expect(subjects).toEqual({
      identity: { resolveSession: "identity.resolve-session.v1" },
      content: { articleArchived: "content.article-archived.v1" },
      production: {
        createJob: "production.create-job.v1",
        jobCompleted: "production.job-completed.v1",
      },
      library: { episodePublished: "library.episode-published.v1" },
    })
    expectTypeOf(
      subjects.production.createJob
    ).toEqualTypeOf<"production.create-job.v1">()
    expectTypeOf<Subject>().toMatchTypeOf<string>()
  })
})
