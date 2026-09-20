import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  contentTags,
  contentTagSuggestions,
} from "../../../../drizzle/schema.js"
import type {
  ContentTaxonomyError,
  ContentTaxonomyRepository,
  CreateTagResult,
  PromoteSuggestionResult,
} from "../../../application/content-taxonomy.js"
import {
  TAG_VOCABULARY_LIMIT,
  TagNameSchema,
} from "../../../domain/content-taxonomy.js"
import type {
  ContentKnowledgeDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import { decodeSuggestion, decodeTag, failure, tagProjection } from "./row.js"

/**
 * 利用者ごとのタグ語彙そのもの：一覧・追加・削除と、AI候補からの昇格。
 */
type TagVocabulary = Pick<
  ContentTaxonomyRepository,
  | "listTags"
  | "createTag"
  | "deleteTag"
  | "listSuggestions"
  | "promoteSuggestion"
  | "vocabulary"
>

const findTagByName = (runner: QueryRunner, ownerId: string, name: string) =>
  runner
    .select(tagProjection)
    .from(contentTags)
    .where(and(eq(contentTags.ownerId, ownerId), eq(contentTags.name, name)))
    .get()

export const makeTagVocabulary = (
  database: ContentKnowledgeDatabase
): TagVocabulary => ({
  listTags: (ownerId) =>
    Effect.try({
      try: () =>
        database
          .select(tagProjection)
          .from(contentTags)
          .where(eq(contentTags.ownerId, ownerId))
          .orderBy(asc(contentTags.name), asc(contentTags.tagId))
          .all(),
      catch: () => failure("ListTags"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => decodeTag(row, "ListTags"))
      ),
      Effect.map(deepFreeze)
    ),

  // 同名タグの再作成は既存を壊さず、いまある1件を読み直して返す。
  // 新規タグは語彙の件数上限を超えて作れない。
  createTag: (ownerId, tag) =>
    Effect.try({
      try: () =>
        database.transaction((tx) => {
          const existing = findTagByName(tx, ownerId, tag.name)
          if (existing !== undefined) {
            return deepFreeze({ kind: "existing" as const, row: existing })
          }
          const { count } = tx
            .select({ count: sql<number>`COUNT(*)`.as("count") })
            .from(contentTags)
            .where(eq(contentTags.ownerId, ownerId))
            .get() ?? { count: 0 }
          if (count >= TAG_VOCABULARY_LIMIT) {
            return deepFreeze({ kind: "limit" as const })
          }
          tx.insert(contentTags)
            .values({
              tagId: tag.tagId,
              ownerId,
              name: tag.name,
              createdAt: tag.createdAt,
            })
            .run()
          return deepFreeze({
            kind: "created" as const,
            row: findTagByName(tx, ownerId, tag.name),
          })
        }),
      catch: () => failure("CreateTag"),
    }).pipe(
      Effect.flatMap(
        (result): Effect.Effect<CreateTagResult, ContentTaxonomyError> =>
          result.kind === "limit"
            ? Effect.succeed(deepFreeze({ _tag: "LimitExceeded" as const }))
            : decodeTag(result.row, "CreateTag").pipe(
                Effect.map((tag) =>
                  deepFreeze({ _tag: "Created" as const, tag })
                )
              )
      )
    ),

  deleteTag: (ownerId, tagId) =>
    Effect.try({
      try: () =>
        Number(
          database
            .delete(contentTags)
            .where(
              and(
                eq(contentTags.ownerId, ownerId),
                eq(contentTags.tagId, tagId)
              )
            )
            .run().changes
        ) === 1,
      catch: () => failure("DeleteTag"),
    }),

  listSuggestions: (ownerId) =>
    Effect.try({
      try: () =>
        database
          .select({
            name: contentTagSuggestions.name,
            occurrences: contentTagSuggestions.occurrences,
            lastSeenAt: contentTagSuggestions.lastSeenAt,
          })
          .from(contentTagSuggestions)
          .where(eq(contentTagSuggestions.ownerId, ownerId))
          .orderBy(
            desc(contentTagSuggestions.occurrences),
            desc(contentTagSuggestions.lastSeenAt),
            asc(contentTagSuggestions.name)
          )
          .all(),
      catch: () => failure("ListSuggestions"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => decodeSuggestion(row, "ListSuggestions"))
      ),
      Effect.map(deepFreeze)
    ),

  // 候補の登録と削除を一度に行い、途中で落ちても候補が二重に残らないようにする。
  // 語彙の件数上限に達している候補は昇格させず、候補も保持する。
  promoteSuggestion: (ownerId, name, tag) =>
    Effect.try({
      try: () =>
        database.transaction((tx) => {
          const suggestion = tx
            .select({ name: contentTagSuggestions.name })
            .from(contentTagSuggestions)
            .where(
              and(
                eq(contentTagSuggestions.ownerId, ownerId),
                eq(contentTagSuggestions.name, name)
              )
            )
            .get()
          if (suggestion === undefined) {
            return deepFreeze({ kind: "not-found" as const })
          }

          // 既に語彙にある名前の候補は昇格で新規タグを作らないため、件数上限を
          // 確認せず、残った候補の掃除だけを行う。
          if (findTagByName(tx, ownerId, name) === undefined) {
            const { count } = tx
              .select({ count: sql<number>`COUNT(*)`.as("count") })
              .from(contentTags)
              .where(eq(contentTags.ownerId, ownerId))
              .get() ?? { count: 0 }
            if (count >= TAG_VOCABULARY_LIMIT) {
              return deepFreeze({ kind: "limit" as const })
            }
          }

          tx.insert(contentTags)
            .values({
              tagId: tag.tagId,
              ownerId,
              name: tag.name,
              createdAt: tag.createdAt,
            })
            .onConflictDoNothing({
              target: [contentTags.ownerId, contentTags.name],
            })
            .run()

          tx.delete(contentTagSuggestions)
            .where(
              and(
                eq(contentTagSuggestions.ownerId, ownerId),
                eq(contentTagSuggestions.name, name)
              )
            )
            .run()

          return deepFreeze({
            kind: "promoted" as const,
            row: findTagByName(tx, ownerId, name),
          })
        }),
      catch: () => failure("PromoteSuggestion"),
    }).pipe(
      Effect.flatMap(
        (
          result
        ): Effect.Effect<PromoteSuggestionResult, ContentTaxonomyError> =>
          result.kind === "not-found"
            ? Effect.succeed(deepFreeze({ _tag: "NotFound" as const }))
            : result.kind === "limit"
              ? Effect.succeed(deepFreeze({ _tag: "LimitExceeded" as const }))
              : decodeTag(result.row, "PromoteSuggestion").pipe(
                  Effect.map((promoted) =>
                    deepFreeze({ _tag: "Promoted" as const, tag: promoted })
                  )
                )
      )
    ),

  vocabulary: (ownerId) =>
    Effect.try({
      try: () =>
        database
          .select({ name: contentTags.name })
          .from(contentTags)
          .where(eq(contentTags.ownerId, ownerId))
          .orderBy(asc(contentTags.name))
          .all(),
      catch: () => failure("ListTags"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          parse(Schema.Struct({ name: Schema.String }))(row).pipe(
            Effect.flatMap(({ name }) => parse(TagNameSchema)(name)),
            Effect.mapError(() => failure("ListTags", "CorruptRecord"))
          )
        )
      ),
      Effect.map(deepFreeze)
    ),
})
