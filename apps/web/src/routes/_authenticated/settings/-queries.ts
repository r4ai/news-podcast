import { api } from "@/shared/api"

/**
 * 設定画面が読むserver stateの契約。
 *
 * routeのloader・画面のhook・invalidationが**同じ定義**を指すようにする
 * (ADR-0047)。鍵を書き写していた頃は、loaderが先読みしないまま画面が
 * mount後に取りに行き、節を開くたびに往復1回分だけ空のカードが出ていた。
 */
export const tagsQueryOptions = api.queryOptions("get", "/v1/me/tags")

export const tagSuggestionsQueryOptions = api.queryOptions(
  "get",
  "/v1/me/tag-suggestions"
)

export const readingDictionaryQueryOptions = api.queryOptions(
  "get",
  "/v1/me/reading-dictionary"
)
