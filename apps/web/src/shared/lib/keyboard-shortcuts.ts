/**
 * アプリが受け付けるキーボード操作の一覧。
 *
 * 実際の割り当てはそれぞれの画面のhookが持つ。ここはそれを**読む**ための
 * 目録で、押せることを利用者へ伝える唯一の場所。目録と実装がずれると
 * 「書いてあるのに効かない」になるので、記事画面の分はhookのdispatch表と
 * 一致することをテストで固定する。
 */
export type Shortcut = {
  /** 表示するキー。複数並べると「どれでも」の意味になる。 */
  readonly keys: readonly string[]
  readonly description: string
}

export type ShortcutGroup = {
  readonly title: string
  readonly shortcuts: readonly Shortcut[]
}

/** どの画面でも効く操作。 */
export const GLOBAL_SHORTCUT_HELP_KEY = "?"

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "全体",
    shortcuts: [
      {
        keys: [GLOBAL_SHORTCUT_HELP_KEY],
        description: "このキーボード操作の一覧を開く",
      },
    ],
  },
  {
    title: "記事",
    shortcuts: [
      { keys: ["j"], description: "次の記事へ" },
      { keys: ["k"], description: "前の記事へ" },
      { keys: ["/"], description: "検索欄へ移動" },
      { keys: ["o"], description: "元記事を別のタブで開く" },
      { keys: ["s"], description: "保存を切り替える" },
      { keys: ["e"], description: "あとで読むを切り替える" },
      { keys: ["u"], description: "未読に戻す" },
    ],
  },
  {
    title: "ライブラリ",
    shortcuts: [
      { keys: ["j"], description: "次の番組へ" },
      { keys: ["k"], description: "前の番組へ" },
    ],
  },
]
