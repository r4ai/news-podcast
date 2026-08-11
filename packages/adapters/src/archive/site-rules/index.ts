import { zennSiteRule } from "./zenn.js"
import type { SiteRule } from "./types.js"

const siteRules: readonly SiteRule[] = [zennSiteRule]

/** URLに合致するサイト別ルールを返す。無ければundefined（汎用処理にフォールバック）。 */
export function resolveSiteRule(url: URL): SiteRule | undefined {
  return siteRules.find((rule) => rule.matches(url))
}

export type { SiteRule } from "./types.js"
