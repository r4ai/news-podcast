import { createFileRoute } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"

import { api } from "@/shared/api"
import { Panel } from "@/shared/components/panel"
import { ArticleList } from "./-components/article-list"
import { ArticleReaderView } from "./-components/article-reader"
import { EnrichQueueDialog } from "./-components/enrich-queue-dialog"
import { useArticleKeyboardShortcuts } from "./-hooks/use-article-keyboard-shortcuts"
import { useArticleList } from "./-hooks/use-article-list"
import { useArticleReader } from "./-hooks/use-article-reader"
import { useEnrichQueueDialog } from "./-hooks/use-enrich-queue"
import {
  siblingArticleId,
  toFacetsQuery,
  validateArticlesSearch,
} from "./-model"

export const Route = createFileRoute("/_authenticated/articles/")({
  validateSearch: validateArticlesSearch,
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context, deps }) => {
    void context.queryClient.ensureQueryData(
      api.queryOptions("get", "/v1/me/articles/facets", {
        params: { query: toFacetsQuery(deps.search) },
      })
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

  const list = useArticleList({ search, onSearchChange })
  const reader = useArticleReader({ articleId: search.article })
  const enrichQueue = useEnrichQueueDialog()

  function selectArticle(id: string | undefined) {
    onSearchChange({ article: id })
  }

  useArticleKeyboardShortcuts({
    onNext: () =>
      selectArticle(siblingArticleId(list.articles, search.article, 1)),
    onPrev: () =>
      selectArticle(siblingArticleId(list.articles, search.article, -1)),
    onOpenOriginal: () => {
      if (reader.article) {
        window.open(reader.article.url, "_blank", "noopener,noreferrer")
      }
    },
    onToggleSaved: reader.toggleSaved,
    onToggleReadLater: reader.toggleReadLater,
    onMarkUnread: reader.markUnread,
  })

  const hasSelection = search.article !== undefined

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-4rem)] lg:gap-6 lg:bg-gradient-to-b lg:from-muted/30 lg:to-transparent">
      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch lg:gap-6">
        <div
          className={cn(
            "lg:w-[360px] lg:shrink-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain",
            hasSelection && "hidden lg:block"
          )}
        >
          <Panel name="article-list">
            <ArticleList
              list={list}
              onSelect={(article) => selectArticle(article.id)}
              onShowEnrichQueue={() => enrichQueue.onOpenChange(true)}
              selectedArticleId={search.article}
            />
          </Panel>
        </div>
        <div
          className={cn(
            "min-h-[60vh] flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain",
            !hasSelection && "hidden lg:flex"
          )}
        >
          <Panel name="article-reader">
            <ArticleReaderView
              {...reader}
              onBack={() => selectArticle(undefined)}
            />
          </Panel>
        </div>
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
