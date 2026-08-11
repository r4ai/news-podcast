import type { Meta, StoryObj } from "@storybook/react-vite"

import { Markdown } from "../../markdown"
import { markdownStory, markdownThemeDecorator } from "../../story-helpers"

const WITH_LANGUAGE = `\`\`\`sql title="migrations/0006_fts.sql"
CREATE VIRTUAL TABLE feed_items_fts USING fts5(
  title, summary, body,
  tokenize = 'trigram'
);
\`\`\`
`

const WITHOUT_LANGUAGE = `言語クラスの無いフェンスでも行番号は常に表示する。

\`\`\`
pnpm vitest run
pnpm build
pnpm test
\`\`\`
`

const HIGHLIGHTED_LINES = `\`\`\`ts {2-3}
const db = openDatabase()
const rows = db.prepare(sql).all()
return rows.map((row) => row.title)
\`\`\`
`

const DIFF = `注記コメントによる差分表示。

\`\`\`ts
const rows = db.prepare(sql).all() // [!code --]
const rows = db.prepare(sql).all(params) // [!code ++]
return rows
\`\`\`

\`lang="diff"\` の行頭記号による差分表示。

\`\`\`diff
- const rows = db.prepare(sql).all()
+ const rows = db.prepare(sql).all(params)
  return rows
\`\`\`
`

const LONG_LINES = `\`\`\`ts
const message = "この行はとても長く、折り返さずに横スクロールで読めることを確認するためのサンプルテキストです。ページ本体側は横スクロールしません。"
\`\`\`
`

const meta = {
  title: "Markdown/Code block",
  component: Markdown,
  decorators: [markdownThemeDecorator],
} satisfies Meta<typeof Markdown>

export default meta
type Story = StoryObj<typeof meta>

export const WithLanguageLight: Story = markdownStory(WITH_LANGUAGE, "light")
export const WithLanguageDark: Story = markdownStory(WITH_LANGUAGE, "dark")

export const WithoutLanguageLight: Story = markdownStory(
  WITHOUT_LANGUAGE,
  "light"
)
export const WithoutLanguageDark: Story = markdownStory(
  WITHOUT_LANGUAGE,
  "dark"
)

export const HighlightedLinesLight: Story = markdownStory(
  HIGHLIGHTED_LINES,
  "light"
)
export const HighlightedLinesDark: Story = markdownStory(
  HIGHLIGHTED_LINES,
  "dark"
)

export const DiffLight: Story = markdownStory(DIFF, "light")
export const DiffDark: Story = markdownStory(DIFF, "dark")

export const LongLinesLight: Story = markdownStory(LONG_LINES, "light")
export const LongLinesDark: Story = markdownStory(LONG_LINES, "dark")
