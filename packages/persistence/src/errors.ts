import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"

/**
 * 永続化層の失敗を表す唯一の型。
 * サービス固有の失敗語彙へはアダプタ側で写像する。
 */
export type DatabaseError = DeepReadonly<{
  readonly _tag: "DatabaseFailed"
  /** 失敗した論理操作。span名やログの粒度と一致させる。 */
  readonly operation: string
  readonly reason: DatabaseFailureReason
}>

export type DatabaseFailureReason =
  | "Unavailable"
  | "ConstraintViolated"
  | "CorruptRecord"

export const databaseError = (
  operation: string,
  reason: DatabaseFailureReason = "Unavailable"
): DatabaseError => deepFreeze({ _tag: "DatabaseFailed", operation, reason })

const constraintMarkers = [
  "SQLITE_CONSTRAINT",
  "UNIQUE constraint failed",
  "CHECK constraint failed",
  "FOREIGN KEY constraint failed",
  "NOT NULL constraint failed",
]

/**
 * SQLiteの制約違反は呼び出し側が分岐に使う正当な結果であり、
 * 到達不能な障害と区別できないと冪等な書き込みが書けない。
 */
export const classifyDatabaseFailure = (
  cause: unknown
): DatabaseFailureReason => {
  const message =
    cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
  return constraintMarkers.some((marker) => message.includes(marker))
    ? "ConstraintViolated"
    : "Unavailable"
}
