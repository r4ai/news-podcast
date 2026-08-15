import type { DatabaseSync } from "node:sqlite"

import { Effect, Scope } from "effect"

import {
  classifyDatabaseFailure,
  databaseError,
  type DatabaseError,
} from "./errors.js"
import { databaseSpanOptions } from "./span.js"
import {
  openDatabaseClientUnsafe,
  type DatabaseClientOptions,
} from "./client.js"

/**
 * 同期ドライバの例外をEffectの型付き失敗へ変換する。
 * node:sqliteは同期APIなので、Effect.tryで十分であり非同期化は不要。
 */
export const attemptDatabase = <Value>(
  operation: string,
  run: () => Value
): Effect.Effect<Value, DatabaseError> =>
  Effect.try({
    try: run,
    catch: (cause) => databaseError(operation, classifyDatabaseFailure(cause)),
  })

/** 計測付きのDB操作。span名と`db.operation.name`を必ず対にする。 */
export const databaseOperation = <Value>(input: {
  readonly namespace: string
  readonly operation: string
  readonly spanName: string
  readonly run: () => Value
}): Effect.Effect<Value, DatabaseError> =>
  attemptDatabase(input.operation, input.run).pipe(
    Effect.withSpan(
      input.spanName,
      databaseSpanOptions(input.namespace, input.operation)
    )
  )

/** プロセス終了時に確実に閉じるスコープ付き接続。サービスにつき1本だけ開く。 */
export const scopedDatabaseClient = (
  options: DatabaseClientOptions
): Effect.Effect<DatabaseSync, DatabaseError, Scope.Scope> =>
  Effect.acquireRelease(
    attemptDatabase("Open", () => openDatabaseClientUnsafe(options)),
    (client) => Effect.sync(() => client.close())
  )
