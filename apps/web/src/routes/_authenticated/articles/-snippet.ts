import { toPlainSnippet } from "@/shared/markdown/lib/to-plain-text"

import type { Article } from "./-model"

/**
 * 一覧行のスニペット。
 *
 * `-model.ts`ではなくここに置くのは、`-model.ts`が`validateSearch`を通じて
 * ルート定義から参照され、初期バンドルへ載るため。remarkのparserを
 * `-model.ts`から引くと、記事ページを開いていないログイン画面などでも
 * Markdown parserを読み込むことになる。行の描画に使うこのモジュールは
 * componentからだけ参照し、ルートのcode splitに乗せる。
 */

/**
 * Markdownから最初の文章ブロックを平文で取り出す。見出しラベル(例: `## 結論`)や
 * Mermaid図、コードブロックは飛ばす。
 *
 * 以前は正規表現でMarkdownを剥がしていたが、リンクの入れ子やcallout記法を
 * 取りこぼしていた(ADR-0042: 構造を正規表現で解釈しない)。
 */
export function aiSummarySnippet(markdown: string): string {
  return toPlainSnippet(markdown)
}

/** AI要約の冒頭を優先し、未処理ならRSSのsummaryへフォールバックする。 */
export function articleSnippet(
  article: Pick<Article, "aiSummary" | "summary">
): string | undefined {
  if (typeof article.aiSummary === "string" && article.aiSummary.length > 0) {
    return aiSummarySnippet(article.aiSummary)
  }
  return article.summary ?? undefined
}
