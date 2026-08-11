// Articles配下の複数ルートで共有するパラメータ・クエリ定義。
import { z } from "@hono/zod-openapi"

import { IdSchema } from "../../http/schemas.js"

export const articleParams = z.object({
  articleId: IdSchema.openapi({ param: { name: "articleId", in: "path" } }),
})

// 単一値/複数値どちらでも渡せるクエリパラメータを配列へ正規化する。
// Honoは同名クエリが1つだけの場合は文字列、複数の場合は配列で渡す。
export const toQueryArray = (value: unknown) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value]

// 期間絞り込み。publishedAfter/publishedBeforeともに境界値を含む閉区間として扱う
// （両方指定時、逆転していれば422）。判定対象はソート基準と揃えたCOALESCE(published_at, discovered_at)。
export const publishedRangeFields = {
  publishedAfter: z.iso.datetime().optional(),
  publishedBefore: z.iso.datetime().optional(),
}
export const publishedRangeValid = (value: {
  readonly publishedAfter?: string
  readonly publishedBefore?: string
}) =>
  !value.publishedAfter ||
  !value.publishedBefore ||
  value.publishedAfter <= value.publishedBefore
export const publishedRangeRefinement = {
  message: "publishedAfter must not be after publishedBefore",
  path: ["publishedBefore"],
}

export const articleStateBody = z.object({
  read: z.boolean().optional(),
  saved: z.boolean().optional(),
  readLater: z.boolean().optional(),
  hidden: z.boolean().optional(),
})

export const hasAnyArticleStateFlag = (value: {
  read?: boolean
  saved?: boolean
  readLater?: boolean
  hidden?: boolean
}) =>
  value.read !== undefined ||
  value.saved !== undefined ||
  value.readLater !== undefined ||
  value.hidden !== undefined
