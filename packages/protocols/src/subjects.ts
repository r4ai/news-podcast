export const subjects = {
  identity: {
    resolveSession: "identity.resolve-session.v1",
  },
  content: {
    articleArchived: "content.article-archived.v1",
  },
  production: {
    createJob: "production.create-job.v1",
    jobCompleted: "production.job-completed.v1",
  },
  library: {
    episodePublished: "library.episode-published.v1",
  },
} as const

type Values<Value> = Value extends string
  ? Value
  : Value extends Readonly<Record<string, unknown>>
    ? Values<Value[keyof Value]>
    : never

export type Subject = Values<typeof subjects>
