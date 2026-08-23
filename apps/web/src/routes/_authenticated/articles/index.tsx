import { createFileRoute } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useLayoutEffect, useRef } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { Panel } from "@/shared/components/panel"
import { usePaneScrollReset } from "@/shared/lib/use-pane-scroll-reset"
import { pageTitle } from "@/shared/lib/page-title"
import {
  articleFacetsQueryOptions,
  articlesInfiniteQueryOptions,
} from "./-queries"
import { ArticleList } from "./-components/article-list"
import {
  ArticleReader,
  EmptySelection,
  ReaderSkeleton,
} from "./-components/article-reader"
import { ConnectedEnrichQueueDialog } from "./-components/enrich-queue-dialog"
import { validateArticlesSearch } from "./-model"

export const Route = createFileRoute("/_authenticated/articles/")({
  head: () => ({ meta: [{ title: pageTitle("記事") }] }),
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

/**
 * 1カラム (lg未満) では一覧と本文がページのスクロールを共有する。
 *
 * 切り替え先が描き上がった commit で、paint の前に位置を移す。前の画面の位置を
 * 持ち越すと、描き終えた後にブラウザ (末尾の切り詰め) やrouterのリセットが
 * スクロールを動かし、一度出た「一覧へ戻る」が上へ飛んでから戻る。
 *
 * 押した瞬間に動かすのでは早すぎる。記事の取得が済むまで一覧は画面に残った
 * ままなので、まだ見えている一覧が先頭へ飛ぶ。
 *
 * 2カラムではページ自身がスクロールしないので、何もしない。
 */
function useSingleColumnScrollSwap(articleId: string | undefined) {
  const listScroll = useRef(0)

  useLayoutEffect(() => {
    const twoColumn = window.matchMedia?.("(min-width: 64rem)").matches ?? true
    if (twoColumn) return
    window.scrollTo({ top: articleId === undefined ? listScroll.current : 0 })
  }, [articleId])

  return listScroll
}

function ArticlesRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  function onSearchChange(
    patch: Partial<typeof search>,
    options?: { readonly replace?: boolean; readonly resetScroll?: boolean }
  ) {
    void navigate({
      replace: options?.replace,
      resetScroll: options?.resetScroll,
      search: (prev) => ({ ...prev, ...patch }),
    })
  }

  const hasSelection = search.article !== undefined
  const listScroll = useSingleColumnScrollSwap(search.article)
  // 2カラムでは本文だけが独立したスクロール領域になる。1カラムのページ全体の
  // 動きは`useSingleColumnScrollSwap`が別に見る。
  const readerPaneRef = usePaneScrollReset(search.article)

  function selectArticle(id: string | undefined) {
    // 一覧を離れる瞬間の位置を控える。戻った時にここへ返す。記事から記事へ
    // 送る時 (既に選択がある) は、控えてあるのが一覧の位置なので触らない。
    if (id !== undefined && !hasSelection) listScroll.current = window.scrollY
    // 一覧と本文の入れ替えではrouterに位置を触らせない。routerのリセットは
    // 描き終えた後に効くので、こちらが移した位置を上書きしてしまう。
    onSearchChange({ article: id, snapshot: undefined }, { resetScroll: false })
  }

  return (
    /*
      lgでは一覧とリーダーがそれぞれ独立したスクロール領域になる (docs/design.md §7.1)。
      モバイルは1カラムで、選択の有無でどちらか一方だけを見せる。

      主領域の余白はこのページでは打ち消す。一覧は「線で区切られた領域」で
      あって浮かぶカードではないので、区切り線は画面の端から端まで通す。
      余白を丸ごと打ち消すので、この枠の高さは「viewportから`AppShell`が
      下端に空けている分(`--player-h` + 1rem)を引いた値」がちょうど収まる高さに
      なる。ここがずれると、2つのスクロール領域の外側にページ自身のスクロールが
      生まれる。

      `--app-bar-h`はAppShellのモバイルapp barの実高 (py-2 + min-h-11)。
      一覧ヘッダーがapp barの下へ潜らないよう、吸着の基準をここで一度だけ決める。
    */
    <div className="-m-4 flex flex-col [--app-bar-h:3.75rem] sm:-m-6 lg:-m-8 lg:h-[calc(100dvh-var(--player-h)-1rem)] lg:min-h-0 lg:flex-row lg:items-stretch">
      {/*
        desktopではページヘッダーを置かない設計 (docs/design.md §7.1) だが、
        ページには必ずlevel-1見出しが要る。視覚には出さず、支援技術へだけ渡す。
      */}
      <h1 className="sr-only">記事</h1>
      <div
        className={cn(
          "lg:min-h-0 lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r xl:w-[420px]",
          hasSelection && "hidden lg:block"
        )}
      >
        {/*
          一覧の表示境界は`ArticleList`の内側、記事行だけに掛かっている。
          ここで包むと、絞り込みを変えるたびに検索欄と状態タブまで骨組みへ
          差し替わる。
        */}
        <ArticleList
          onSearchChange={onSearchChange}
          onSelect={selectArticle}
          search={search}
          selectedArticleId={search.article}
        />
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:p-8",
          !hasSelection && "hidden lg:flex"
        )}
        // 位置が戻ることをe2eで確かめるための目印。スクロールしているのは
        // 本文ではなくこの枠なので、検査もここへ当てる。
        data-reader-pane=""
        ref={readerPaneRef}
      >
        {/*
          一覧へ戻る導線は取得を待たない。表示境界の外に置くことで、記事を
          開いた瞬間から押せて、本文が届いても位置が動かない。
        */}
        {hasSelection ? (
          <Button
            className="mb-3 self-start lg:hidden"
            onClick={() => selectArticle(undefined)}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            一覧へ戻る
          </Button>
        ) : null}
        <Panel fallback={<ReaderSkeleton />} name="article-reader">
          {search.article === undefined ? (
            <EmptySelection />
          ) : (
            // 別の記事は別のインスタンス。切り替えはnavigate (=Transition) の
            // 中で起きるので、新しい記事が揃うまで前の記事が表示され続ける。
            <ArticleReader
              articleId={search.article}
              includeHidden={search.includeHidden}
              key={`${search.article}:${search.snapshot ?? "latest"}`}
              snapshotId={search.snapshot}
            />
          )}
        </Panel>
      </div>

      <ConnectedEnrichQueueDialog />
    </div>
  )
}
