import type { Decorator, Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { useEffect, type ReactNode } from "react"

import type { Article } from "../-model"
import {
  ArticleReaderView,
  type ArticleReaderViewProps,
} from "./article-reader"

type Theme = "light" | "dark"

function ThemeFrame({
  theme,
  children,
}: {
  readonly theme: Theme
  readonly children: ReactNode
}) {
  useEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains("dark")
    root.classList.toggle("dark", theme === "dark")
    return () => {
      root.classList.toggle("dark", hadDark)
    }
  }, [theme])

  return (
    <div
      className={theme === "dark" ? "dark" : undefined}
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <main className="mx-auto max-w-2xl p-4 sm:p-6">{children}</main>
    </div>
  )
}

const themeDecorator: Decorator = (Story, context) => {
  const theme = (context.parameters.theme as Theme) ?? "light"
  return (
    <ThemeFrame theme={theme}>
      <Story />
    </ThemeFrame>
  )
}

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
    ...overrides,
  } as Article
}

const SHORT_MARKDOWN = "# React 19\n\n並行機能を試した。"

const LONG_MARKDOWN = `# React 19の並行機能をSuspenseで使い倒す

並行レンダリングと新しい\`use\`APIを、実際のアプリ構成で試した記録です。

## 背景

これまでのReactでは、データ取得のタイミングとレンダリングのタイミングが密結合していました。

- Suspenseは宣言的な読み込み境界を提供する
- \`use\`はPromiseとContextをどちらも読める
- トランジションはUIの応答性を保つ

## 実装

\`\`\`ts title="src/hooks/use-article.ts"
export function useArticle(id: string) {
  return use(fetchArticle(id))
}
\`\`\`

## まとめ

並行機能は既存コードへ段階的に導入できます。まずは重い一覧から試すのがよいでしょう。

## 参考

さらに詳しい話は本文の続きにあります。並行レンダリングの内部実装、schedulerの優先度、Offscreenとの関係など、長期的に追いたいトピックがまだ多く残っています。
`

const baseArticle = article({})

function readerArgs(
  overrides: Partial<ArticleReaderViewProps>
): ArticleReaderViewProps {
  return {
    articleId: baseArticle.id,
    article: baseArticle,
    source: "markdown",
    setSource: fn(),
    didAutoFallback: false,
    markdown: LONG_MARKDOWN,
    isMarkdownLoading: false,
    archiveUrl: undefined,
    isArchiveLoading: false,
    archiveUnavailable: false,
    retryArchive: fn(),
    toggleSaved: fn(),
    toggleReadLater: fn(),
    toggleHidden: fn(),
    markUnread: fn(),
    recalculateAi: fn(),
    isRecalculating: false,
    ...overrides,
  }
}

const meta = {
  title: "Articles/Article reader",
  component: ArticleReaderView,
  args: readerArgs({}),
  parameters: { theme: "light" },
  decorators: [themeDecorator],
} satisfies Meta<typeof ArticleReaderView>

export default meta
type Story = StoryObj<typeof meta>

export const MarkdownSource: Story = {}
export const MarkdownSourceDark: Story = {
  parameters: { theme: "dark" },
}

export const AutoFallbackToArchive: Story = {
  args: readerArgs({
    source: "archive",
    didAutoFallback: true,
    markdown: SHORT_MARKDOWN,
    archiveUrl: "/v1/me/article-snapshots/snapshot/replay/index.html",
  }),
}

export const NoContentAvailable: Story = {
  args: readerArgs({
    source: "archive",
    didAutoFallback: true,
    markdown: "",
    archiveUrl: undefined,
    archiveUnavailable: true,
  }),
}

export const WithAiBlock: Story = {
  args: readerArgs({
    article: article({
      aiSummary:
        "## 結論\nSuspenseとuseでUIの読み込み境界を宣言的に扱える。\n\n```mermaid\nflowchart LR\nA[読み込み] --> B[Suspenseで表示]\n```\n\n- トランジションで重い更新でも応答性を維持\n- 既存コードでは一覧などの重い箇所から段階導入",
      relevanceScore: 82,
      relevanceReason: "フロントエンドの並行レンダリングに関する実装記録のため",
    }),
  }),
}

export const AiNotProcessed: Story = {
  args: readerArgs({}),
}

export const LongArticle: Story = {
  args: readerArgs({ markdown: LONG_MARKDOWN }),
}

export const MobileWidth: Story = {
  decorators: [
    (Story) => (
      <div className="mx-auto w-[390px]">
        <Story />
      </div>
    ),
  ],
}
