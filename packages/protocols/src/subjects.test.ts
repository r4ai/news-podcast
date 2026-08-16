import { describe, expect, expectTypeOf, it } from "vitest"

import { subjects, type Subject } from "./subjects.js"

describe("versioned NATS subjects", () => {
  it("keeps the integration surface explicit and versioned", () => {
    expect(subjects).toEqual({
      identity: {
        resolveSession: "identity.resolve-session.v1",
        getGenerationSettings: "identity.get-generation-settings.v1",
        updateGenerationSettings: "identity.update-generation-settings.v1",
        discoverDueGenerations: "identity.discover-due-generations.v1",
        completeScheduledGeneration:
          "identity.complete-scheduled-generation.v1",
      },
      content: {
        articleLibrary: "content.article-library.v1",
        addSubscription: "content.add-subscription.v1",
        listSubscriptions: "content.list-subscriptions.v1",
        deleteSubscription: "content.delete-subscription.v1",
        syncSubscription: "content.sync-subscription.v1",
        updateSubscription: "content.update-subscription.v1",
        listFeedCatalog: "content.list-feed-catalog.v1",
        listFeedSyncJobs: "content.list-feed-sync-jobs.v1",
        materializeArticles: "content.materialize-articles.v1",
        planGeneration: "content.plan-generation.v1",
        personalization: "content.personalization.v1",
      },
      production: {
        createJob: "production.create-job.v1",
        getJob: "production.get-job.v1",
        listJobs: "production.list-jobs.v1",
        listJobEvents: "production.list-job-events.v1",
        cancelJob: "production.cancel-job.v1",
        retryJob: "production.retry-job.v1",
        readingDictionary: "production.reading-dictionary.v1",
        jobCompleted: "production.job-completed.v1",
        jobCompletedV2: "production.job-completed.v2",
      },
      library: {
        episodePublished: "library.episode-published.v1",
        listEpisodes: "library.list-episodes.v1",
        getEpisode: "library.get-episode.v1",
        createAudioAccess: "library.create-audio-access.v1",
      },
    })
    expectTypeOf(
      subjects.production.createJob
    ).toEqualTypeOf<"production.create-job.v1">()
    expectTypeOf<Subject>().toMatchTypeOf<string>()
  })
})
