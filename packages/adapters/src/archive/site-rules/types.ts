import type TurndownService from "turndown"

/**
 * サイトごとの変換の特別対応。汎用ルールでは救えないサイト固有の構造を
 * ここに差し込む。すべてのフックは省略可能で、無ければ汎用処理にフォールバックする。
 */
export interface SiteRule {
  readonly id: string
  /** このルールを適用するURLかどうか。 */
  matches(url: URL): boolean
  /**
   * Readabilityへ渡す前にDOMを整える。汎用の正規化（callout化や脚注化）より先に走るため、
   * サイト固有のマークアップを汎用ルールが拾える形へ変換するのに使う。
   */
  prepare?(document: Document, url: URL): void
  /** 本文要素を直接選ぶ。返せばReadabilityを使わずこの要素をそのまま変換する。 */
  selectContent?(document: Document, url: URL): Element | null
  /** Turndownへ追加するルール。キーはaddRuleのキーとして使う。 */
  turndownRules?: Record<string, TurndownService.Rule>
}
