import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { htmlToMarkdown } from "./html-to-markdown.js"

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "html-to-markdown"
)
const DEFAULT_SOURCE_URL = "https://example.com/articles/fts5"

/** サイト別ルールを効かせたい fixture はここでURLを指定する。 */
const SOURCE_URLS: Record<string, string> = {
  "zenn-article.html": "https://zenn.dev/example/articles/fts5",
}

/**
 * ゴールデンテスト。`.html` ごとに同名の `.md` を期待値として比較する。
 * 変換を改善したら `UPDATE_GOLDEN=1 pnpm vitest run src/archive/html-to-markdown`
 * で期待値を再生成し、差分をレビューする。
 */
describe("htmlToMarkdown golden files", () => {
  const cases = readdirSync(fixturesDir).filter((name) =>
    name.endsWith(".html")
  )

  it("has fixtures", () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const htmlName of cases) {
    it(htmlName, () => {
      const markdownPath = join(fixturesDir, htmlName.replace(/\.html$/, ".md"))
      const actual = htmlToMarkdown(
        readFileSync(join(fixturesDir, htmlName), "utf8"),
        SOURCE_URLS[htmlName] ?? DEFAULT_SOURCE_URL
      )
      if (process.env.UPDATE_GOLDEN) {
        writeFileSync(markdownPath, actual)
        return
      }
      expect(actual).toBe(readFileSync(markdownPath, "utf8"))
    })
  }
})
