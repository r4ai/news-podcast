import type { SQLInputValue } from "node:sqlite"
import type { DeepReadonly } from "@news-podcast/kernel"

export type IdentitySqlitePort = DeepReadonly<{
  readonly execute: (sql: string) => void
  readonly get: (sql: string, parameters?: readonly SQLInputValue[]) => unknown
  readonly all: (
    sql: string,
    parameters?: readonly SQLInputValue[]
  ) => readonly unknown[]
  readonly run: (
    sql: string,
    parameters?: readonly SQLInputValue[]
  ) => DeepReadonly<{ readonly changes: number | bigint }>
  readonly transaction: <Value>(operation: () => Value) => Value
  readonly close: () => void
}>
