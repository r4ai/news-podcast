import { Hono } from "hono"

export interface AppDependencies {
  readonly authHandler?: (request: Request) => Response | Promise<Response>
  readonly createEpisodeJob?: (input: {
    readonly request: Request
    readonly idempotencyKey: string
  }) => Promise<{
    readonly id: string
    readonly status: "queued"
    readonly createdAt: string
  }>
}

const unavailableProblem = {
  type: "https://news-podcast.example/problems/service-unavailable",
  title: "Service unavailable",
  status: 503,
  code: "service-unavailable",
} as const

export function createApp(dependencies: AppDependencies = {}) {
  const app = new Hono()

  app.get("/health", (context) => context.json({ status: "ok" }))

  if (dependencies.authHandler) {
    app.on(["GET", "POST"], "/api/auth/*", (context) =>
      dependencies.authHandler!(context.req.raw)
    )
  }

  app.on(["GET", "PATCH"], "/v1/me/settings", (context) =>
    context.json(unavailableProblem, 503)
  )
  app.post("/v1/episode-jobs", async (context) => {
    if (!dependencies.createEpisodeJob) {
      return context.json(unavailableProblem, 503)
    }

    const idempotencyKey = context.req.header("Idempotency-Key")
    if (!idempotencyKey) {
      return context.json(
        {
          type: "https://news-podcast.example/problems/validation",
          title: "Invalid request",
          status: 400,
          code: "missing-idempotency-key",
        },
        400
      )
    }

    const receipt = await dependencies.createEpisodeJob({
      request: context.req.raw,
      idempotencyKey,
    })
    context.header("Location", `/v1/episode-jobs/${receipt.id}`)
    context.header("Idempotency-Key", idempotencyKey)
    context.header("Retry-After", "2")
    return context.json(receipt, 202)
  })

  return app
}
