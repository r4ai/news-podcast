import type { Meta, StoryObj } from "@storybook/react-vite"

import { Markdown } from "../../markdown"
import { markdownStory, markdownThemeDecorator } from "../../story-helpers"

const VALID_DIAGRAM = `\`\`\`mermaid
graph TD;
  A[RSS] --> B[Archive];
  B --> C[Markdown変換];
  C --> D[表示];
\`\`\`
`

// 閉じ括弧が無い等、構文として壊れている図。
const BROKEN_DIAGRAM = `\`\`\`mermaid
graph TD;
  A[RSS --> B[Archive
\`\`\`
`

const meta = {
  title: "Markdown/Mermaid",
  component: Markdown,
  decorators: [markdownThemeDecorator],
} satisfies Meta<typeof Markdown>

export default meta
type Story = StoryObj<typeof meta>

export const ValidLight: Story = markdownStory(VALID_DIAGRAM, "light")
export const ValidDark: Story = markdownStory(VALID_DIAGRAM, "dark")

export const BrokenLight: Story = markdownStory(BROKEN_DIAGRAM, "light")
export const BrokenDark: Story = markdownStory(BROKEN_DIAGRAM, "dark")
