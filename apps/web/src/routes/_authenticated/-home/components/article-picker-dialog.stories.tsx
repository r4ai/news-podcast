import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import type { Article } from "@/features/articles"

import { MAX_SELECTED_ARTICLES } from "../model"
import { ArticlePickerDialog } from "./article-picker-dialog"

function article(id: string, title: string, relevanceScore?: number): Article {
  return {
    id,
    feedId: "00000000-0000-4000-8000-000000000001",
    sourceName: "Zenn",
    title,
    url: `https://zenn.dev/${id}`,
    discoveredAt: "2026-08-11T02:00:00.000Z",
    publishedAt: "2026-08-11T01:00:00.000Z",
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    ...(relevanceScore === undefined ? {} : { relevanceScore }),
  } as Article
}

const articles = [
  article(
    "a1",
    "Cloudflare WorkersのDurable Objectsが東京リージョンに対応",
    92
  ),
  article("a2", "TypeScript 6.0のリリース候補が公開", 81),
  article("a3", "SQLiteのWALモードを本番で使うときの落とし穴", 74),
]

const meta = {
  title: "Foundation/Article picker dialog",
  component: ArticlePickerDialog,
  args: {
    open: true,
    articles,
    selected: new Set<string>(),
    selectedCount: 0,
    atLimit: false,
    hasSearchQuery: false,
    searchQuery: "",
    onOpenChange: fn(),
    onToggle: fn(),
    onSelectTop: fn(),
    onClear: fn(),
    onLoadMore: fn(),
    onRetry: fn(),
    onSearchChange: fn(),
    onConfirm: fn(),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ArticlePickerDialog>

export default meta
type Story = StoryObj<typeof meta>

/** 未選択では生成できない。数を選ばせるのがこの画面の役目。 */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText("記事を選択してください")).toBeVisible()
    await expect(
      body.getByRole("button", { name: /この記事で生成/ })
    ).toBeDisabled()
  },
}

export const WithSelection: Story = {
  args: { selected: new Set(["a1", "a3"]), selectedCount: 2 },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      body.getByText(`2/${MAX_SELECTED_ARTICLES}件を選択中`)
    ).toBeVisible()

    await userEvent.click(body.getByRole("button", { name: /この記事で生成/ }))
    await expect(args.onConfirm).toHaveBeenCalledOnce()
  },
}

/** 上限に達したら未選択行を押せなくして、422を作らせない。 */
export const AtLimit: Story = {
  args: {
    selected: new Set(["a1", "a2"]),
    selectedCount: MAX_SELECTED_ARTICLES,
    atLimit: true,
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const checkboxes = body.getAllByRole("checkbox")
    await expect(checkboxes[2]).toBeDisabled()
  },
}

export const Loading: Story = {
  args: { articles: [], isLoading: true },
}

export const NoCandidates: Story = {
  args: { articles: [] },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText("選べる記事がまだありません")).toBeVisible()
  },
}

export const LoadFailed: Story = {
  args: { articles: [], isError: true },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole("button", { name: "再読み込み" }))
    await expect(args.onRetry).toHaveBeenCalledOnce()
  },
}
