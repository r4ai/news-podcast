import type { SQLInputValue } from "node:sqlite"

import type { DeepReadonly } from "@news-podcast/kernel"

export type SqlitePort = DeepReadonly<{
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

export type JsonInterop = DeepReadonly<{
  readonly parse: (input: string) => unknown
  readonly stringify: (input: unknown) => string
}>
