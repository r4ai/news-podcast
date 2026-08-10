import { Newspaper } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"

import { useArticleList } from "../-hooks/use-article-list"
import type { Article } from "../-model"
import { ArticleCard } from "./article-card"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function ArticleList() {
  const list = useArticleList()
  return <ArticleListView {...list} />
}

export type ArticleListViewProps = {
  readonly articles: readonly Article[]
  readonly search: string
  readonly setSearch: (value: string) => void
  readonly toggleSaved: (article: Article) => void
  readonly markRead: (article: Article) => void
}

export function ArticleListView({
  articles,
  markRead,
  search,
  setSearch,
  toggleSaved,
}: ArticleListViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <Input
        aria-label="記事を検索"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="タイトルまたは媒体名で検索"
        value={search}
      />
      {articles.length > 0 ? (
        <div className="flex flex-col gap-3">
          {articles.map((article) => (
            <ArticleCard
              article={article}
              key={article.id}
              onOpenArchive={markRead}
              onToggleSaved={toggleSaved}
            />
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
