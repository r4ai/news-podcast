// タグ語彙のCRUDと、AI付与候補（タグサジェスト）の一覧・昇格。
import type { RouteRegistrar } from "../../http/context.js"
import { registerCreateTag } from "./create.js"
import { registerDeleteTag } from "./delete.js"
import { registerListTags } from "./list.js"
import { registerPromoteTagSuggestion } from "./promote.js"
import { registerListTagSuggestions } from "./suggestions.js"

export const tagsRegistrars: readonly RouteRegistrar[] = [
  registerListTags,
  registerCreateTag,
  registerDeleteTag,
  registerListTagSuggestions,
  registerPromoteTagSuggestion,
]
