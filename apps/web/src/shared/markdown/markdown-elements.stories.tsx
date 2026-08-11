import type { Meta, StoryObj } from "@storybook/react-vite"

import { Markdown } from "./markdown"
import { markdownStory, markdownThemeDecorator } from "./story-helpers"

const TABLE = `| 方式 | 索引サイズ | 辞書 |
| --- | --- | --- |
| trigram | 3〜4倍 | 不要 |
| 形態素解析 | 小さい | 必要 |
`

const CALLOUTS = `> [!NOTE]
> trigramは辞書が不要です。

> [!TIP]
> 数万件規模なら先にtrigramで試すと早い。

> [!IMPORTANT]
> 索引再構築中はクエリを止めてください。

> [!WARNING]
> 索引サイズは3〜4倍に膨らみます。

> [!CAUTION]
> 本番データで実測せずに採用しないでください。
`

const MATH = `インデックス構築の計算量は $O(n \\log n)$ になります。

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$
`

const FOOTNOTES = `索引は元テキストの3〜4倍になります[^1]。用途によっては形態素解析も検討します[^2]。

[^1]: 実測値。対象は日本語の技術記事3万件。
[^2]: 辞書更新の運用コストとのトレードオフになる。
`

const IMAGE_CAPTION = `![索引サイズの推移](assets/aa11bb.png)

件数を増やしたときの索引サイズの推移。3万件付近で頭打ちになる。
`

const UNKNOWN_LANGUAGE = `\`\`\`made-up-lang
this uses a language Shiki does not know about
and must fall back to plain text without crashing
\`\`\`
`

const TASK_LIST = `- [x] トークナイザを決める
- [ ] 索引サイズを実測する
- [ ] ベンチマーク結果をレビューする
`

const meta = {
  title: "Markdown/Elements",
  component: Markdown,
  decorators: [markdownThemeDecorator],
} satisfies Meta<typeof Markdown>

export default meta
type Story = StoryObj<typeof meta>

export const TableLight: Story = markdownStory(TABLE, "light")
export const TableDark: Story = markdownStory(TABLE, "dark")

export const CalloutsLight: Story = markdownStory(CALLOUTS, "light")
export const CalloutsDark: Story = markdownStory(CALLOUTS, "dark")

export const MathLight: Story = markdownStory(MATH, "light")
export const MathDark: Story = markdownStory(MATH, "dark")

export const FootnotesLight: Story = markdownStory(FOOTNOTES, "light")
export const FootnotesDark: Story = markdownStory(FOOTNOTES, "dark")

export const ImageCaptionLight: Story = markdownStory(IMAGE_CAPTION, "light")
export const ImageCaptionDark: Story = markdownStory(IMAGE_CAPTION, "dark")

export const UnknownLanguageLight: Story = markdownStory(
  UNKNOWN_LANGUAGE,
  "light"
)
export const UnknownLanguageDark: Story = markdownStory(
  UNKNOWN_LANGUAGE,
  "dark"
)

export const TaskListLight: Story = markdownStory(TASK_LIST, "light")
export const TaskListDark: Story = markdownStory(TASK_LIST, "dark")
