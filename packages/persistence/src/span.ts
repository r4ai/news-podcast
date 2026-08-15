import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"

export type DatabaseSpanOptions = DeepReadonly<{
  readonly kind: "client"
  readonly attributes: {
    readonly "db.system.name": "sqlite"
    readonly "db.namespace": string
    readonly "db.operation.name": string
  }
}>

/**
 * OpenTelemetryのDB span属性を一箇所に固定する。
 * 各リポジトリが個別に属性を綴ると、ダッシュボードのクエリが静かに壊れる。
 */
export const databaseSpanOptions = (
  namespace: string,
  operation: string
): DatabaseSpanOptions =>
  deepFreeze({
    kind: "client" as const,
    attributes: {
      "db.system.name": "sqlite" as const,
      "db.namespace": namespace,
      "db.operation.name": operation,
    },
  })
