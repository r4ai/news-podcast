import { createFileRoute } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"

import { Panel } from "@/shared/components/panel"
import {
  articleFacetsQueryOptions,
  articlesInfiniteQueryOptions,
} from "./-queries"
import { ArticleList, ArticleListSkeleton } from "./-components/article-list"
import {
  ArticleReader,
  EmptySelection,
  ReaderSkeleton,
} from "./-components/article-reader"
import { EnrichQueueDialog } from "./-components/enrich-queue-dialog"
import { useEnrichQueueDialog } from "./-hooks/use-enrich-queue"
import { validateArticlesSearch } from "./-model"

export const Route = createFileRoute("/_authenticated/articles/")({
  validateSearch: validateArticlesSearch,
  // 選択中の記事はloaderの依存に入れない。記事を切り替えるたびに一覧の
  // loaderが走ると、ページングで積んだページが捨てられる。
  loaderDeps: ({ search }) => ({ search: { ...search, article: undefined } }),
  loader: ({ context, deps }) => {
    // 一覧本体もここで走らせ、mount後に初めて取りに行く往復を無くす。
    void context.queryClient.ensureInfiniteQueryData(
      articlesInfiniteQueryOptions(deps.search)
    )
    void context.queryClient.ensureQueryData(
      articleFacetsQueryOptions(deps.search)
    )
  },
  component: ArticlesRoute,
})

function ArticlesRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  function onSearchChange(
    patch: Partial<typeof search>,
    options?: { readonly replace?: boolean }
  ) {
    void navigate({
      replace: options?.replace,
      search: (prev) => ({ ...prev, ...patch }),
    })
  }

  const enrichQueue = useEnrichQueueDialog()

  function selectArticle(id: string | undefined) {
    onSearchChange({ article: id })
  }

  const hasSelection = search.article !== undefined

  return (
    // lgでは一覧とリーダーがそれぞれ独立したスクロール領域になる (docs/design.md §7.1)。
    // モバイルは1カラムで、選択の有無でどちらか一方だけを見せる。
    // `--app-bar-h`はAppShellのモバイルapp barの実高 (py-2 + min-h-11)。
    // 一覧ヘッダーがapp barの下へ潜らないよう、吸着の基準をここで一度だけ決める。
    <div className="flex flex-col [--app-bar-h:3.75rem] lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:flex-row lg:items-stretch lg:gap-6">
      {/*
        desktopではページヘッダーを置かない設計 (docs/design.md §7.1) だが、
        ページには必ずlevel-1見出しが要る。視覚には出さず、支援技術へだけ渡す。
      */}
      <h1 className="sr-only">記事</h1>
      <div
        className={cn(
          "lg:min-h-0 lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain xl:w-[420px]",
          hasSelection && "hidden lg:block"
        )}
      >
        <Panel fallback={<ArticleListSkeleton />} name="article-list">
          <ArticleList
            onSearchChange={onSearchChange}
            onSelect={selectArticle}
            onShowEnrichQueue={() => enrichQueue.onOpenChange(true)}
            search={search}
            selectedArticleId={search.article}
          />
        </Panel>
      </div>
      <div
        className={cn(
          "flex flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain",
          !hasSelection && "hidden lg:flex"
        )}
      >
        <Panel fallback={<ReaderSkeleton />} name="article-reader">
          {search.article === undefined ? (
            <EmptySelection />
          ) : (
            // 別の記事は別のインスタンス。切り替えはnavigate (=Transition) の
            // 中で起きるので、新しい記事が揃うまで前の記事が表示され続ける。
            <ArticleReader
              articleId={search.article}
              includeHidden={search.includeHidden}
              key={search.article}
              onBack={() => selectArticle(undefined)}
            />
          )}
        </Panel>
      </div>

      <EnrichQueueDialog
        connected={enrichQueue.connected}
        onOpenChange={enrichQueue.onOpenChange}
        open={enrichQueue.open}
        status={enrichQueue.status}
      />
    </div>
  )
}
