import type { Meta, StoryObj } from "@storybook/react-vite"

import { Markdown } from "./markdown"
import { markdownStory, markdownThemeDecorator } from "./story-helpers"

/**
 * Content Knowledgeのアーカイブ処理が出力する記法を
 * できるだけ再現した長文fixture。GFMテーブル、GitHub Alerts風callout、
 * 脚注、数式、ファイル名付き/無しコードブロック、`<details>`生HTML、
 * Mermaidを一通り含む。
 */
const FULL_FIXTURE = `# SQLite FTS5 で日本語全文検索を実用にする

- Author: 山田 太郎
- Source: https://example.com/articles/fts5

日本語は空白で語を区切らないため、FTS5 の既定 \`unicode61\` トークナイザでは実質的に使い物になりません。選択肢は二つあります。

## trigram を使う

3文字単位で索引を張るので任意の部分文字列にヒットし、辞書のメンテナンスも不要です。代償は索引サイズで、元テキストのおよそ3〜4倍に膨らみます。

- 辞書が不要
- 部分一致に強い
- 索引が大きい

## ベンチマーク結果

| 方式 | 索引サイズ | 辞書 |
| --- | --- | --- |
| trigram | 3〜4倍 | 不要 |
| 形態素解析 | 小さい | 必要 |

## ファイル名つきコードブロック

\`\`\`sql title="migrations/0006_fts.sql"
CREATE VIRTUAL TABLE feed_items_fts USING fts5(
  title, summary, body,
  tokenize = 'trigram'
);
\`\`\`

差分を見るとこうなります。

\`\`\`ts title="src/search.ts"
const rows = db.prepare(sql).all() // [!code ++]
return rows.map((row) => row.title)
\`\`\`

言語クラスの無いブロックもあります。

\`\`\`
pnpm vitest run
\`\`\`

## メッセージボックス

> [!NOTE]
> trigramは辞書が不要です。

> [!WARNING]
> 索引サイズは3〜4倍に膨らみます。数万件規模なら実測してから採用してください。

## 折りたたみ

<details>
<summary>実測の詳細</summary>

3万件の日本語技術記事で計測しました。

</details>

## 図とキャプション

![索引サイズの推移](assets/aa11bb.png)

件数を増やしたときの索引サイズの推移。3万件付近で頭打ちになる。

## タスクリスト

- [x] トークナイザを決める
- [ ] 索引サイズを実測する

## Mermaid

\`\`\`mermaid
graph TD;
  A[RSS] --> B[Archive];
  B --> C[Markdown変換];
  C --> D[表示];
\`\`\`

## 脚注

索引は元テキストの3〜4倍になります[^1]。

[^1]: 実測値。対象は日本語の技術記事3万件。

## 数式

インデックス構築の計算量は $O(n \\log n)$ になります。
`

const meta = {
  title: "Markdown/Fixture",
  component: Markdown,
  args: { markdown: FULL_FIXTURE },
  decorators: [markdownThemeDecorator],
} satisfies Meta<typeof Markdown>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = markdownStory(FULL_FIXTURE, "light")
export const Dark: Story = markdownStory(FULL_FIXTURE, "dark")
