import type { DeepReadonly } from "@news-podcast/kernel"
import type {
  Actor,
  CorrelationId,
  MessageId,
  Traceparent,
} from "@news-podcast/protocols"
import type { Effect } from "effect"

import type {
  ArchiveCapture,
  ArchiveRequestId,
  ArticleSnapshot,
  ArticleUrl,
  CapturedAt,
  SnapshotId,
} from "../../domain/article.js"

export type CaptureError = DeepReadonly<{
  readonly _tag: "CaptureFailed"
  readonly reason:
    | "Blocked"
    | "MalformedResponse"
    | "ResourceLimit"
    | "Unavailable"
}>

export type ArchiveStoreError = DeepReadonly<{
  readonly _tag: "ArchiveStoreFailed"
  readonly operation: "Lookup" | "Commit" | "ListReferences"
  readonly reason: "Conflict" | "CorruptRecord" | "Unavailable"
}>

export type ArchiveMaintenancePorts = DeepReadonly<{
  readonly listReferencedSnapshotIds: () => Effect.Effect<
    readonly SnapshotId[],
    ArchiveStoreError
  >
}>

export type ArchiveLookup =
  | DeepReadonly<{ readonly _tag: "NotArchived" }>
  | DeepReadonly<{
      readonly _tag: "Archived"
      readonly snapshot: ArticleSnapshot
    }>

export type ArchiveCommit =
  | DeepReadonly<{ readonly _tag: "Committed" }>
  | DeepReadonly<{
      readonly _tag: "AlreadyCommitted"
      readonly snapshot: ArticleSnapshot
    }>

export type ArchiveMessageContext = DeepReadonly<{
  readonly messageId: MessageId
  readonly correlationId: CorrelationId
  readonly traceparent: Traceparent
  readonly actor: Actor
}>

export type ArchiveArticlePorts = DeepReadonly<{
  readonly lookup: (
    archiveRequestId: ArchiveRequestId
  ) => Effect.Effect<ArchiveLookup, ArchiveStoreError>
  readonly capture: (input: {
    readonly sourceUrl: ArticleUrl
    readonly snapshotId: SnapshotId
  }) => Effect.Effect<ArchiveCapture, CaptureError>
  readonly newSnapshotId: () => SnapshotId
  readonly now: () => CapturedAt
  /** Persists the immutable snapshot idempotently. */
  readonly commit: (input: {
    readonly snapshot: ArticleSnapshot
  }) => Effect.Effect<ArchiveCommit, ArchiveStoreError>
}>
