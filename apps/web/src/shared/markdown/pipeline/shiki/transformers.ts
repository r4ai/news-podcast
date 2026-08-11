import type { ShikiTransformer } from "shiki/core"

const DIFF_NOTATION_PATTERN =
  /[ \t]*(?:\/\/|#|--|<!--)\s*\[!code (\+\+|--)\]\s*(?:-->)?[ \t]*$/

/**
 * `// [!code ++]` / `// [!code --]` 注記(transformerNotationDiff相当)を
 * トークン化前に取り除き、行番号をmetaへ記録するpreprocessフック。
 * pre要素の属性へ自動でシリアライズされるため、Reactコンポーネント側は
 * 追加のhastトラバースなしに `diffAdd` / `diffRemove` propで読める。
 */
export const notationDiffTransformer: ShikiTransformer = {
  name: "markdown:notation-diff",
  preprocess(code) {
    const added: number[] = []
    const removed: number[] = []
    const lines = code.split("\n").map((line, index) => {
      const match = DIFF_NOTATION_PATTERN.exec(line)
      if (!match) {
        return line
      }
      ;(match[1] === "++" ? added : removed).push(index + 1)
      return line.slice(0, match.index)
    })
    if (added.length === 0 && removed.length === 0) {
      return
    }
    this.options.meta = {
      ...this.options.meta,
      diffAdd: added.join(","),
      diffRemove: removed.join(","),
    }
    return lines.join("\n")
  },
}

/**
 * ハイライト後の生コード(コピー用)を `<pre data-raw-code>` として残す。
 * preprocessでdiff注記を取り除いた後の文字列が `this.source` に入る。
 */
export const rawSourceTransformer: ShikiTransformer = {
  name: "markdown:raw-source",
  pre(node) {
    node.properties["data-raw-code"] = this.source
  },
}
