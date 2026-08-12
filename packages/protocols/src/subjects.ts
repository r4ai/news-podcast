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
    jobCompletedV2: "production.job-completed.v2",
  },
  library: {
    episodePublished: "library.episode-published.v1",
    listEpisodes: "library.list-episodes.v1",
    createAudioAccess: "library.create-audio-access.v1",
  },
} as const

type Values<Value> = Value extends string
  ? Value
  : Value extends Readonly<Record<string, unknown>>
    ? Values<Value[keyof Value]>
    : never

export type Subject = Values<typeof subjects>
