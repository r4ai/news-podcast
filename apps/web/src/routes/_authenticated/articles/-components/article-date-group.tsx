import type { ArticleGroup } from "../-model"
import { ArticleRow } from "./article-row"
import type { ArticleRowProps } from "./article-row"
import { ARTICLE_GROUP_STICKY_TOP } from "./article-list-header"

export type ArticleDateGroupProps = {
  readonly group: ArticleGroup
  /** `sort`がnewest/oldestの時だけ見出しを出す (docs要求)。 */
  readonly showHeader: boolean
  readonly selectedArticleId: string | undefined
  readonly onToggleSaved: ArticleRowProps["onToggleSaved"]
  readonly onSelect: ArticleRowProps["onSelect"]
}

/**
 * `ul`は`li`以外を子に持てないので、日付見出しはリストの外に置いて
 * 見出し+リストの対にする。見出しはlgでツールバーの直下へ吸着する。
 */
export function ArticleDateGroup({
  group,
  showHeader,
  selectedArticleId,
  onToggleSaved,
  onSelect,
}: ArticleDateGroupProps) {
  return (
    <section aria-labelledby={showHeader ? `group-${group.key}` : undefined}>
      {showHeader ? (
        <h3
          className={`sticky z-10 border-b border-border/60 bg-background/70 px-3 py-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-xl ${ARTICLE_GROUP_STICKY_TOP}`}
          id={`group-${group.key}`}
        >
          {group.label}
        </h3>
      ) : null}
      <ul>
        {group.articles.map((article) => (
          <ArticleRow
            article={article}
            isSelected={article.id === selectedArticleId}
            key={article.id}
            onSelect={onSelect}
            onToggleSaved={onToggleSaved}
          />
        ))}
      </ul>
    </section>
  )
}
