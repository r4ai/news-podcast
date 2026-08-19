import { and, eq } from "drizzle-orm"
import { decodePersistedJsonSync } from "@news-podcast/persistence"
import { Schema } from "effect"

import {
  episodeDictionarySnapshots,
  episodeExecutionCheckpoints,
  episodeGenerationPlans,
  episodeJobs,
} from "../../../../drizzle/schema.js"
import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { ArticleIdSchema } from "../../../domain/episode-job.js"
import { GenerationPlanSchema } from "../../../domain/generation-plan.js"
import type { JobPlanHandle, StoredCheckpointRow } from "./ports.js"
import { leaseHolder } from "./shared.js"

const PersistedArticleIdsSchema = Schema.Array(ArticleIdSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(20),
  Schema.isUnique()
)
const PersistedGenerationPlanSchema = Schema.toEncoded(GenerationPlanSchema)

const generationPlanDocument = (row: {
  readonly jobId: string
  readonly ownerId: string
  readonly selectionMode: "automatic" | "manual"
  readonly profileInclude: string
  readonly profileExclude: string
  readonly selectedArticleIds: string
  readonly model: string
  readonly createdAt: string
}): string =>
  JSON.stringify({
    jobId: row.jobId,
    ownerId: row.ownerId,
    selectionMode: row.selectionMode,
    interestProfile: {
      include: row.profileInclude,
      exclude: row.profileExclude,
    },
    selectedArticleIds: decodePersistedJsonSync(
      "episode_generation_plans.selected_article_ids",
      PersistedArticleIdsSchema,
      row.selectedArticleIds
    ),
    model: row.model,
    createdAt: row.createdAt,
  })

/** Generation plan, dictionary snapshot, and execution checkpoint persistence. */
export const makeJobPlanHandle = (
  database: ProductionDatabase
): JobPlanHandle => ({
  loadCheckpoint: (jobId): StoredCheckpointRow | undefined => {
    const row = database
      .select()
      .from(episodeExecutionCheckpoints)
      .where(eq(episodeExecutionCheckpoints.jobId, jobId))
      .get()
    return row === undefined
      ? undefined
      : {
          script: row.script,
          ...(row.audio === null ? {} : { audio: row.audio }),
        }
  },

  loadGenerationPlan: (jobId) => {
    const row = database
      .select()
      .from(episodeGenerationPlans)
      .where(eq(episodeGenerationPlans.jobId, jobId))
      .get()
    return row === undefined ? undefined : generationPlanDocument(row)
  },

  listUsedAutomaticArticleIds: (ownerId) => {
    const rows = database
      .select({ articleIds: episodeGenerationPlans.selectedArticleIds })
      .from(episodeGenerationPlans)
      .innerJoin(
        episodeJobs,
        eq(episodeJobs.jobId, episodeGenerationPlans.jobId)
      )
      .where(
        and(
          eq(episodeGenerationPlans.ownerId, ownerId),
          eq(episodeGenerationPlans.selectionMode, "automatic"),
          eq(episodeJobs.status, "Succeeded")
        )
      )
      .all()
    return [
      ...new Set(
        rows.flatMap((row) =>
          decodePersistedJsonSync(
            "episode_generation_plans.selected_article_ids",
            PersistedArticleIdsSchema,
            row.articleIds
          )
        )
      ),
    ]
  },

  saveGenerationPlan: (input) =>
    database.transaction((tx) => {
      if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
        return { _tag: "StaleLease" as const }
      }
      const plan = decodePersistedJsonSync(
        "episode_generation_plans.plan",
        PersistedGenerationPlanSchema,
        input.plan
      )
      tx.insert(episodeGenerationPlans)
        .values({
          jobId: input.jobId,
          ownerId: plan.ownerId,
          selectionMode: plan.selectionMode,
          profileInclude: plan.interestProfile.include,
          profileExclude: plan.interestProfile.exclude,
          selectedArticleIds: JSON.stringify(plan.selectedArticleIds),
          model: plan.model,
          createdAt: plan.createdAt,
        })
        .onConflictDoNothing({ target: episodeGenerationPlans.jobId })
        .run()
      const stored = tx
        .select()
        .from(episodeGenerationPlans)
        .where(eq(episodeGenerationPlans.jobId, input.jobId))
        .get()
      if (stored === undefined) throw new Error("generation plan missing")
      return {
        _tag: "Stored" as const,
        plan: generationPlanDocument(stored),
      }
    }),

  loadDictionarySnapshot: (jobId) =>
    database
      .select({ snapshot: episodeDictionarySnapshots.snapshot })
      .from(episodeDictionarySnapshots)
      .where(eq(episodeDictionarySnapshots.jobId, jobId))
      .get()?.snapshot,

  saveDictionarySnapshot: (input) =>
    database.transaction((tx) => {
      if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
        return "StaleLease" as const
      }
      tx.insert(episodeDictionarySnapshots)
        .values({ jobId: input.jobId, snapshot: input.snapshot })
        .onConflictDoNothing({ target: episodeDictionarySnapshots.jobId })
        .run()
      const stored = tx
        .select({ snapshot: episodeDictionarySnapshots.snapshot })
        .from(episodeDictionarySnapshots)
        .where(eq(episodeDictionarySnapshots.jobId, input.jobId))
        .get()
      return stored?.snapshot === input.snapshot
        ? ("Applied" as const)
        : ("Conflict" as const)
    }),

  saveScriptCheckpoint: (input) =>
    database.transaction((tx) => {
      if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
        return false
      }
      tx.insert(episodeExecutionCheckpoints)
        .values({ jobId: input.jobId, script: input.script, audio: null })
        .onConflictDoUpdate({
          target: episodeExecutionCheckpoints.jobId,
          set: { script: input.script },
        })
        .run()
      return true
    }),

  saveAudioCheckpoint: (input) =>
    database.transaction((tx) => {
      if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
        return "StaleLease" as const
      }
      return Number(
        tx
          .update(episodeExecutionCheckpoints)
          .set({ audio: input.audio })
          .where(eq(episodeExecutionCheckpoints.jobId, input.jobId))
          .run().changes
      ) === 1
        ? ("Applied" as const)
        : ("MissingScript" as const)
    }),
})
