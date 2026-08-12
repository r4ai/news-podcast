import type { ArticleGroup } from "../-model"
import { ArticleRow } from "./article-row"
import type { ArticleRowProps } from "./article-row"

export type ArticleDateGroupProps = {
  readonly group: ArticleGroup
  /** `sort`がnewest/oldestの時だけ見出しを出す (docs要求)。 */
  readonly showHeader: boolean
  /** `sort`がrelevanceの時だけ行にスコアを表示する。 */
  readonly showRelevanceScore: boolean
  readonly selectedArticleId: string | undefined
  readonly onToggleSaved: ArticleRowProps["onToggleSaved"]
  readonly onSelect: ArticleRowProps["onSelect"]
}

export function ArticleDateGroup({
  group,
  showHeader,
  showRelevanceScore,
  selectedArticleId,
  onToggleSaved,
  onSelect,
}: ArticleDateGroupProps) {
  return (
    <div>
      {showHeader ? (
        <div className="sticky top-10 z-[5] border-b bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
          {group.label}
        </div>
      ) : null}
      <div>
        {group.articles.map((article) => (
          <ArticleRow
            article={article}
            isSelected={article.id === selectedArticleId}
            key={article.id}
            onSelect={onSelect}
            onToggleSaved={onToggleSaved}
            showRelevanceScore={showRelevanceScore}
          />
        ))}
      </div>
    </div>
  )
}
