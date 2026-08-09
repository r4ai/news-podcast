import type { components } from "@news-podcast/contracts/openapi"
import {
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  FileText,
  Newspaper,
} from "lucide-react"
import { useDeferredValue, useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"

import { api } from "@/api/client"
import { PageHeader } from "@/app/page-header"
import { queryClient } from "@/app/query-client"

type Article = components["schemas"]["Article"]

export function ArticlesPage() {
  const query = api.useSuspenseQuery("get", "/v1/me/articles")
  const patch = api.useMutation("patch", "/v1/me/articles/{articleId}")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [, startTransition] = useTransition()
  const queryKey = api.queryOptions("get", "/v1/me/articles").queryKey
  const articles = deferredSearch
    ? query.data.items.filter((article) =>
        `${article.title} ${article.sourceName}`
          .toLocaleLowerCase()
          .includes(deferredSearch)
      )
    : query.data.items

  function updateArticle(
    article: Article,
    state: { read?: boolean; saved?: boolean }
  ) {
    setPendingIds((current) => new Set(current).add(article.id))
    startTransition(async () => {
      try {
        const updated = await patch.mutateAsync({
          params: { path: { articleId: article.id } },
          body: state,
        })
        queryClient.setQueryData(
          queryKey,
          (current: typeof query.data | undefined) =>
            current
              ? {
                  ...current,
                  items: current.items.map((item) =>
                    item.id === article.id ? updated : item
                  ),
                }
              : current
        )
      } catch {
        toast.error("記事の状態を更新できませんでした")
      } finally {
        setPendingIds((current) => {
          const next = new Set(current)
          next.delete(article.id)
          return next
        })
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="記事"
        description="購読フィードの記事を読み、保存済みアーカイブを開けます。"
      />
      <Input
        aria-label="記事を検索"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="タイトルまたは媒体名で検索"
        value={search}
      />

      {articles.length > 0 ? (
        <div className="flex flex-col gap-3">
          {articles.map((article) => (
            <Card key={article.id} size="sm">
              <CardHeader>
                <CardTitle>
                  <h2>{article.title}</h2>
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <span>{article.sourceName}</span>
                  {article.publishedAt ? (
                    <time dateTime={article.publishedAt}>
                      {new Intl.DateTimeFormat("ja-JP", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(article.publishedAt))}
                    </time>
                  ) : null}
                  <Badge
                    variant={
                      article.archiveStatus === "succeeded"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {archiveLabel(article.archiveStatus)}
                  </Badge>
                </CardDescription>
                <CardAction className="flex gap-1">
                  <Button
                    aria-label={article.saved ? "保存を解除" : "記事を保存"}
                    disabled={pendingIds.has(article.id)}
                    onClick={() =>
                      updateArticle(article, { saved: !article.saved })
                    }
                    size="icon-sm"
                    variant="ghost"
                  >
                    {article.saved ? (
                      <BookmarkCheck aria-hidden="true" />
                    ) : (
                      <Bookmark aria-hidden="true" />
                    )}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {article.summary ? (
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {article.summary}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {article.archiveUrl ? (
                    <a
                      className={buttonVariants({ variant: "outline" })}
                      href={article.archiveUrl}
                      onClick={() => updateArticle(article, { read: true })}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileText data-icon="inline-start" />
                      アーカイブを読む
                    </a>
                  ) : null}
                  <a
                    className={buttonVariants({ variant: "ghost" })}
                    href={article.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink data-icon="inline-start" />
                    元の記事
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Newspaper aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>表示できる記事がありません</EmptyTitle>
            <EmptyDescription>
              RSSを購読すると、同期された記事がここに表示されます。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function archiveLabel(status: Article["archiveStatus"]): string {
  return {
    pending: "保存待ち",
    archiving: "保存中",
    succeeded: "保存済み",
    failed: "保存失敗",
  }[status]
}
