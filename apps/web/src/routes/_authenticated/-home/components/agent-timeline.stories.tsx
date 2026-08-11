import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"

import { AgentTimeline } from "./agent-timeline"

const meta = {
  title: "Foundation/Agent timeline",
  component: AgentTimeline,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-2xl p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof AgentTimeline>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {
  args: {
    streaming: true,
    timeline: [
      {
        kind: "step",
        stepName: "researching_sources",
        label: "記事を調査中",
        done: false,
      },
      {
        kind: "tool",
        toolCallId: "t1",
        name: "read_article",
        label: "記事を読む",
        args: '{"article_id":"a1"}',
        done: true,
      },
      {
        kind: "tool",
        toolCallId: "t2",
        name: "web_search",
        label: "Webで裏取り",
        args: '{"query":"Cloudflare Workers 障害"}',
        done: false,
      },
    ],
    adoptedArticles: [
      {
        articleId: "a1",
        title: "Cloudflare WorkersのDurable Objectsが東京リージョンに対応",
        url: "https://zenn.dev/example/a1",
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
        stepName: "researching_sources",
        label: "記事を調査中",
        done: true,
      },
      {
        kind: "tool",
        toolCallId: "t1",
        name: "submit_episode_draft",
        label: "台本を提出",
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
        url: "https://zenn.dev/example/a1",
        sourceName: "Zenn",
      },
      {
        articleId: "a2",
        title: "もう一件の記事タイトル",
        url: "https://azukiazusa.dev/example/a2",
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
      within(canvasElement).queryByText("エージェントの作業")
    ).toBeNull()
  },
}
