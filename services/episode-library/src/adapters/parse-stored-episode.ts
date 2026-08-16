import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  AudioObjectKeySchema,
  ArticleIdSchema,
  CompletedEpisodeSchema,
  EpisodeIdSchema,
  EpisodeScriptSchema,
  EpisodeTitleSchema,
  HttpUrlSchema,
  OwnerIdSchema,
  SnapshotIdSchema,
  UtcInstantSchema,
  type CompletedEpisode,
  type EpisodeSource,
} from "../domain/episode.js"

const RawRssSourceSchema = Schema.Struct({
  sourceKind: Schema.Literal("rss"),
  articleId: Schema.optionalKey(ArticleIdSchema),
  url: HttpUrlSchema,
  title: Schema.NonEmptyString,
  publishedAt: Schema.optionalKey(UtcInstantSchema),
  snapshotId: SnapshotIdSchema,
})

const RawWebSourceSchema = Schema.Struct({
  sourceKind: Schema.Literal("web"),
  url: HttpUrlSchema,
  title: Schema.NonEmptyString,
})

const StoredEpisodeRowSchema = Schema.Struct({
  id: EpisodeIdSchema,
  ownerId: OwnerIdSchema,
  title: EpisodeTitleSchema,
  script: EpisodeScriptSchema,
  audioObjectKey: AudioObjectKeySchema,
  audioByteLength: Schema.Int.check(Schema.isGreaterThan(0)),
  audioContentType: Schema.Literals(["audio/wav", "audio/mpeg"]),
  createdAt: UtcInstantSchema,
  sources: Schema.NonEmptyArray(
    Schema.Union([RawRssSourceSchema, RawWebSourceSchema])
  ),
})

const parseStoredEpisodeRow = parse(StoredEpisodeRowSchema)
const parseDomainEpisode = parse(CompletedEpisodeSchema)

/** Converts untrusted persistence output into the only valid completed state. */
export const parseCompletedEpisode = (input: unknown) =>
  parseStoredEpisodeRow(input).pipe(
    Effect.map((row) => ({
      _tag: "CompletedEpisode" as const,
      id: row.id,
      ownerId: row.ownerId,
      title: row.title,
      script: row.script,
      audio: {
        objectKey: row.audioObjectKey,
        byteLength: row.audioByteLength,
        contentType: row.audioContentType,
      },
      sources: row.sources.map((source): EpisodeSource =>
        source.sourceKind === "rss"
          ? {
              _tag: "RssSource",
              ...(source.articleId === undefined
                ? {}
                : { articleId: source.articleId }),
              url: source.url,
              title: source.title,
              ...(source.publishedAt
                ? { publishedAt: source.publishedAt }
                : {}),
              snapshotId: source.snapshotId,
            }
          : {
              _tag: "WebSource",
              url: source.url,
              title: source.title,
            }
      ) as [EpisodeSource, ...EpisodeSource[]],
      createdAt: row.createdAt,
    })),
    Effect.flatMap(parseDomainEpisode),
    Effect.map((episode) => deepFreeze(episode) as CompletedEpisode)
  )
