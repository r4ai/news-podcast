import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, within } from "storybook/test"

import { defaultArticlesSearch, type Article } from "../-model"
import { ArticleListView, type ArticleListViewProps } from "./article-list"

function article(overrides: Partial<Article>): Article {
  return {
    id: "article-1",
    feedId: "feed-1",
    sourceName: "Zenn",
    title: "React 19の並行機能をSuspenseで使い倒す",
    url: "https://example.com/article",
    discoveredAt: "2026-08-11T08:00:00.000Z",
    publishedAt: "2026-08-11T08:00:00.000Z",
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    summary:
      "並行レンダリングと新しいuse APIを、実際のアプリ構成で試した記録。",
    ...overrides,
  } as Article
}

const unreadArticles = [
  article({ id: "a1", title: "React 19の並行機能をSuspenseで使い倒す" }),
  article({
    id: "a2",
    title: "OpenTelemetryでWebフロントの分散traceを組む",
    sourceName: "Hacker News",
    publishedAt: "2026-08-10T21:00:00.000Z",
  }),
  article({
    id: "a3",
    title: "SQLiteのFTS5で全文検索を高速化する",
    sourceName: "Zenn",
    publishedAt: "2026-07-20T09:00:00.000Z",
    read: true,
    saved: true,
  }),
]

const baseArgs = {
  facets: {
    states: { all: 3, unread: 2, saved: 1, later: 0 },
    feeds: [
      { feedId: "feed-1", name: "Zenn", count: 2 },
      { feedId: "feed-2", name: "Hacker News", count: 1 },
    ],
    aiPending: 0,
  },
  aiPending: 0,
  search: defaultArticlesSearch,
  q: "",
  isLoading: false,
  isError: false,
  isSyncing: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  nextPageFailed: false,
  refetch: fn(),
  fetchNextPage: fn(),
  setQ: fn(),
  setState: fn(),
  setSort: fn(),
  setFeedIds: fn(),
  setIncludeHidden: fn(),
  toggleSaved: fn(),
  markRead: fn(),
  markAllRead: fn(),
  isMarkingAllRead: false,
  onSelect: fn(),
  selectedArticleId: undefined,
} satisfies Omit<ArticleListViewProps, "articles" | "groups">

const meta = {
  title: "Articles/Article list",
  component: ArticleListView,
  args: {
    ...baseArgs,
    articles: unreadArticles,
    groups: [
      { key: "today", label: "今日", articles: [unreadArticles[0]!] },
      { key: "yesterday", label: "昨日", articles: [unreadArticles[1]!] },
      { key: "older", label: "それ以前", articles: [unreadArticles[2]!] },
    ],
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-md p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof ArticleListView>

export default meta
type Story = StoryObj<typeof meta>

export const UnreadOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("今日")).toBeVisible()
    await expect(canvas.getByText("それ以前")).toBeVisible()
  },
}

export const Empty: Story = {
  args: { articles: [], groups: [] },
}

export const NoSearchResults: Story = {
  args: {
    articles: [],
    groups: [],
    search: { ...defaultArticlesSearch, q: "存在しないキーワード" },
    q: "存在しないキーワード",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText("検索に一致する記事がありません")
    ).toBeVisible()
  },
}

export const WithArchiveFailures: Story = {
  args: {
    articles: [
      article({
        id: "f1",
        title: "アーカイブに失敗した記事",
        archiveStatus: "failed",
      }),
      article({
        id: "f2",
        title: "アーカイブ保存待ちの記事",
        archiveStatus: "pending",
      }),
    ],
    groups: [
      {
        key: "today",
        label: "今日",
        articles: [
          article({
            id: "f1",
            title: "アーカイブに失敗した記事",
            archiveStatus: "failed",
          }),
          article({
            id: "f2",
            title: "アーカイブ保存待ちの記事",
            archiveStatus: "pending",
          }),
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("保存失敗")).toBeVisible()
    await expect(canvas.getByText("保存待ち")).toBeVisible()
  },
}

export const Loading: Story = {
  args: { isLoading: true, articles: [], groups: [] },
}

export const LongTitle: Story = {
  args: {
    articles: [
      article({
        id: "long",
        title:
          "とても長い記事タイトルの折り返し表示を確認するためのダミーテキストで、一覧行では1行に省略される想定のサンプル見出しです",
      }),
    ],
    groups: [
      {
        key: "today",
        label: "今日",
        articles: [
          article({
            id: "long",
            title:
              "とても長い記事タイトルの折り返し表示を確認するためのダミーテキストで、一覧行では1行に省略される想定のサンプル見出しです",
          }),
        ],
      },
    ],
  },
}

export const WithAiSummary: Story = {
  args: {
    articles: [
      article({
        id: "tagged",
        title: "React Compilerの内部実装を読む",
        summary: "RSS由来の要約（AI要約が無い場合のフォールバック確認用）。",
        aiSummary:
          "**React Compilerはメモ化をコンパイラがJSXから自動生成する。**\n\n- 既存のuseMemo/useCallbackは段階的に不要\n- 既存コードの書き換えなしで導入可能",
        relevanceScore: 82,
      }),
    ],
    groups: [
      {
        key: "today",
        label: "今日",
        articles: [
          article({
            id: "tagged",
            title: "React Compilerの内部実装を読む",
            aiSummary:
              "React Compilerはメモ化をコンパイラがJSXから自動生成する。",
            relevanceScore: 82,
          }),
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        "React Compilerはメモ化をコンパイラがJSXから自動生成する。"
      )
    ).toBeVisible()
  },
}

export const MobileWidth: Story = {
  decorators: [
    (Story) => (
      <main className="mx-auto w-[360px] p-3">
        <Story />
      </main>
    ),
  ],
}
