export const subjects = {
  identity: {
    resolveSession: "identity.resolve-session.v1",
  },
  content: {
    articleArchived: "content.article-archived.v1",
    addSubscription: "content.add-subscription.v1",
    listSubscriptions: "content.list-subscriptions.v1",
    deleteSubscription: "content.delete-subscription.v1",
    materializeArticles: "content.materialize-articles.v1",
  },
  production: {
    createJob: "production.create-job.v1",
    getJob: "production.get-job.v1",
    listJobs: "production.list-jobs.v1",
    listJobEvents: "production.list-job-events.v1",
    cancelJob: "production.cancel-job.v1",
    retryJob: "production.retry-job.v1",
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
