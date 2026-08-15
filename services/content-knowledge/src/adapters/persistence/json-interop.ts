import type { DeepReadonly } from "@news-podcast/kernel"

/**
 * 例外を投げるJSON APIを注入で受け取るための境界。
 * スナップショットとエンベロープの直列化はこの型を通してのみ行う。
 */
export type JsonInterop = DeepReadonly<{
  readonly parse: (input: string) => unknown
  readonly stringify: (input: unknown) => string
}>
