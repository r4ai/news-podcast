import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"

import { GenerationTimeline } from "./generation-timeline"

const meta = {
  title: "Foundation/Generation timeline",
  component: GenerationTimeline,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-2xl p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof GenerationTimeline>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {
  args: {
    streaming: true,
    timeline: [
      {
        kind: "step",
        stepName: "selecting_articles",
        label: "記事を選定中",
        done: true,
      },
      {
        kind: "step",
        stepName: "materializing_articles",
        label: "記事本文を固定中",
        done: true,
      },
      {
        kind: "step",
        stepName: "generating_script",
        label: "台本を生成中",
        done: false,
      },
    ],
    adoptedArticles: [
      {
        articleId: "a1",
        title: "Cloudflare WorkersのDurable Objectsが東京リージョンに対応",
        sourceName: "Zenn",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("ライブ")).toBeVisible()
    await expect(canvas.getByText("採用した記事 1件")).toBeVisible()
  },
}

export const Finished: Story = {
  args: {
    streaming: false,
    timeline: [
      {
        kind: "step",
        stepName: "generating_script",
        label: "台本を生成中",
        done: true,
      },
      {
        kind: "step",
        stepName: "preparing_pronunciation",
        label: "読み方を準備中",
        done: true,
      },
      {
        kind: "step",
        stepName: "synthesizing_audio",
        label: "音声を生成中",
        done: true,
      },
    ],
    adoptedArticles: [
      {
        articleId: "a1",
        title: "記事タイトル",
        sourceName: "Zenn",
      },
      {
        articleId: "a2",
        title: "もう一件の記事タイトル",
        sourceName: "azukiazusaのテックブログ",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // 終了後は「ライブ」バッジを出さない。
    await expect(canvas.queryByText("ライブ")).toBeNull()
  },
}

/** タイムラインが空のときは、カードごと出さない。 */
export const Hidden: Story = {
  args: { timeline: [], adoptedArticles: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByText("Podcast生成の進捗")
    ).toBeNull()
  },
}
