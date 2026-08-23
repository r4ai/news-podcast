import { Link } from "@tanstack/react-router"
import { ChevronDown, ExternalLink, Quote } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"

import { COLLAPSIBLE_PANEL_ANIMATION } from "@/shared/lib/collapsible"
import { sourceKindLabel, type EpisodeSource } from "../-model"

export type EpisodeSourcesProps = {
  readonly sources: readonly EpisodeSource[]
  readonly className?: string
  /**
   * 開いた状態で描き始めるか。右レールは開いたまま (台本と並ぶので邪魔に
   * ならない)、台本の前に置く器は畳んだまま (開くと台本が毎回その分だけ
   * 下へ押される)。
   */
  readonly defaultOpen?: boolean
}

/**
 * 台本の根拠になった記事。
 *
 * 外部URLは失効するので、保存済みの記事 (`articleId`) がある出典には
 * アプリ内の保存版への導線も並べる (docs/design.md §8)。
 */
export function EpisodeSources({
  className,
  defaultOpen = true,
  sources,
}: EpisodeSourcesProps) {
  return (
    <Collapsible
      className={cn(
        "rounded-xl border border-border/70 bg-card/40 text-sm",
        className
      )}
      defaultOpen={defaultOpen}
      // ランドマークとして名前を持つのはこの器。`<aside>`にはしない
      // (AppShellのサイドバーが既にcomplementaryを持つため)。
      render={<nav aria-label="出典" />}
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <Quote
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="flex-1 text-xs font-semibold tracking-wide text-foreground/80 uppercase">
          出典
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {sources.length}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>

      <CollapsibleContent
        className={COLLAPSIBLE_PANEL_ANIMATION}
        hiddenUntilFound
      >
        <ol className="mr-2 mb-2.5 ml-3.5 flex flex-col gap-3 border-l border-border/70">
          {sources.map((source, index) => (
            <li
              className="-ml-px flex flex-col gap-1 border-l-2 border-transparent pl-3"
              key={`${source.url}-${index}`}
            >
              <a
                aria-label={`外部サイトで開く ${source.title}`}
                className="rounded-sm text-[0.8125rem] leading-5 font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                href={source.url}
                rel="noreferrer"
                target="_blank"
              >
                {source.title}
                <ExternalLink
                  aria-hidden="true"
                  className="mb-0.5 ml-1 inline size-3 text-muted-foreground"
                />
              </a>
              <SourceMeta source={source} />
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SourceMeta({ source }: { readonly source: EpisodeSource }) {
  const kind = sourceKindLabel(source.sourceKind)
  const published =
    source.publishedAt === null || source.publishedAt === undefined
      ? undefined
      : new Date(source.publishedAt).toLocaleDateString("ja-JP")

  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      {kind === undefined ? null : <span>{kind}</span>}
      {published === undefined ? null : <span>{published}</span>}
      {/*
        外部URLは消えるが、保存した記事は残る。両方への行き先を持たせる。
      */}
      {source.articleId === null || source.articleId === undefined ? null : (
        <Link
          className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          // 既読でも保存でも必ず開けるよう、絞り込みは`all`で渡す。既定の
          // `unread`のままだと、読み終えた記事が一覧から消えて隣に何も無い。
          search={{
            state: "all",
            sort: "newest",
            q: "",
            feedIds: [],
            includeHidden: false,
            article: source.articleId,
            snapshot: source.snapshotId ?? undefined,
          }}
          to="/articles"
        >
          {source.snapshotId == null
            ? "最新の保存版を開く"
            : "生成時の保存版を開く"}
        </Link>
      )}
    </span>
  )
}
