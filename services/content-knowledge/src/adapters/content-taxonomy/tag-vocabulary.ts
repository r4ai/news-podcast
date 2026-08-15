import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  ContentTaxonomyError,
  ContentTaxonomyRepository,
  PromoteSuggestionResult,
} from "../../application/content-taxonomy.js"
import { TagNameSchema } from "../../domain/content-taxonomy.js"
import type { SqlitePort } from "../sqlite-port.js"
import { decodeSuggestion, decodeTag, failure } from "./schema.js"

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

const selectTag = `SELECT tag_id AS tagId, name, created_at AS createdAt
                     FROM content_tags`

export const makeTagVocabulary = (database: SqlitePort): TagVocabulary => ({
  listTags: (ownerId) =>
    Effect.try({
      try: () =>
        database.all(`${selectTag} WHERE owner_id = ? ORDER BY name, tag_id`, [
          ownerId,
        ]),
      catch: () => failure("ListTags"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => decodeTag(row, "ListTags"))
      ),
      Effect.map(deepFreeze)
    ),

  // 同名タグの再作成は既存を壊さず、いまある1件を読み直して返す。
  createTag: (ownerId, tag) =>
    Effect.try({
      try: () => {
        database.run(
          `INSERT INTO content_tags(tag_id, owner_id, name, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(owner_id, name) DO NOTHING`,
          [tag.tagId, ownerId, tag.name, tag.createdAt]
        )
        return database.get(`${selectTag} WHERE owner_id = ? AND name = ?`, [
          ownerId,
          tag.name,
        ])
      },
      catch: () => failure("CreateTag"),
    }).pipe(Effect.flatMap((row) => decodeTag(row, "CreateTag"))),

  deleteTag: (ownerId, tagId) =>
    Effect.try({
      try: () =>
        Number(
          database.run(
            "DELETE FROM content_tags WHERE owner_id = ? AND tag_id = ?",
            [ownerId, tagId]
          ).changes
        ) === 1,
      catch: () => failure("DeleteTag"),
    }),

  listSuggestions: (ownerId) =>
    Effect.try({
      try: () =>
        database.all(
          `SELECT name, occurrences, last_seen_at AS lastSeenAt
             FROM content_tag_suggestions
            WHERE owner_id = ?
            ORDER BY occurrences DESC, last_seen_at DESC, name`,
          [ownerId]
        ),
      catch: () => failure("ListSuggestions"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => decodeSuggestion(row, "ListSuggestions"))
      ),
      Effect.map(deepFreeze)
    ),

  // 候補の登録と削除を一度に行い、途中で落ちても候補が二重に残らないようにする。
  promoteSuggestion: (ownerId, name, tag) =>
    Effect.try({
      try: () =>
        database.transaction(() => {
          const suggestion = database.get(
            `SELECT 1 FROM content_tag_suggestions
              WHERE owner_id = ? AND name = ?`,
            [ownerId, name]
          )
          if (suggestion === undefined) return undefined
          database.run(
            `INSERT INTO content_tags(tag_id, owner_id, name, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(owner_id, name) DO NOTHING`,
            [tag.tagId, ownerId, tag.name, tag.createdAt]
          )
          database.run(
            `DELETE FROM content_tag_suggestions
              WHERE owner_id = ? AND name = ?`,
            [ownerId, name]
          )
          return database.get(`${selectTag} WHERE owner_id = ? AND name = ?`, [
            ownerId,
            name,
          ])
        }),
      catch: () => failure("PromoteSuggestion"),
    }).pipe(
      Effect.flatMap(
        (row): Effect.Effect<PromoteSuggestionResult, ContentTaxonomyError> =>
          row === undefined
            ? Effect.succeed(deepFreeze({ _tag: "NotFound" }))
            : decodeTag(row, "PromoteSuggestion").pipe(
                Effect.map((promoted) =>
                  deepFreeze({ _tag: "Promoted" as const, tag: promoted })
                )
              )
      )
    ),

  vocabulary: (ownerId) =>
    Effect.try({
      try: () =>
        database.all(
          "SELECT name FROM content_tags WHERE owner_id = ? ORDER BY name",
          [ownerId]
        ),
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
