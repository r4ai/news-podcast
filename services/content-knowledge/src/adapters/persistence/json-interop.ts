import type { DeepReadonly } from "@news-podcast/kernel"

/**
 * 例外を投げるJSON直列化APIを注入で受け取るための境界。
 * 復号は @news-podcast/persistence のstrict decoderだけを使う。
 */
export type JsonInterop = DeepReadonly<{
  readonly stringify: (input: unknown) => string
}>
