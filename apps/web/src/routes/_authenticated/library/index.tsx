import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  episodeQueryOptions,
  episodesInfiniteQueryOptions,
} from "@/features/episodes"
import { Panel } from "@/shared/components/panel"
import { pageTitle } from "@/shared/lib/page-title"
import {
  EmptySelection,
  EpisodeDetail,
  EpisodeDetailSkeleton,
} from "./-components/episode-detail"
import { EpisodeList } from "./-components/episode-list"
import { validateLibrarySearch } from "./-model"

export const Route = createFileRoute("/_authenticated/library/")({
  head: () => ({ meta: [{ title: pageTitle("ライブラリ") }] }),
  validateSearch: validateLibrarySearch,
  loaderDeps: ({ search }) => ({ episode: search.episode }),
  loader: ({ context, deps }) => {
    // 画面が読むものはloaderで先読みする。mount後に取りに行くと、その分だけ
    // 空の枠が見える (ADR-0047)。
    void context.queryClient.ensureInfiniteQueryData(
      episodesInfiniteQueryOptions
    )
    if (deps.episode !== undefined) {
      void context.queryClient.ensureQueryData(
        episodeQueryOptions(deps.episode)
      )
    }
  },
  component: LibraryRoute,
})

/**
 * 番組を切り替えたら、詳細の頭から見せる。
 *
 * スクロールしているのは外側の枠で、`key`で差し替わるのは中身だけなので、
 * 位置は前の台本のまま残る。長い台本を読んだ後に隣の番組を開くと、題名も
 * 再生ボタンも画面の外から始まってしまう。
 */
function useDetailPaneScrollReset(episodeId: string | undefined) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [episodeId])

  return ref
}

function LibraryRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  function selectEpisode(episodeId: string | undefined) {
    void navigate({ search: () => ({ episode: episodeId }) })
  }

  const hasSelection = search.episode !== undefined
  const detailPaneRef = useDetailPaneScrollReset(search.episode)

  return (
    /*
      記事ページと同じ2ペイン。lgでは一覧と詳細がそれぞれ独立したスクロール
      領域になり、モバイルは1カラムで選択の有無でどちらか一方だけを見せる。
      `--app-bar-h`はAppShellのモバイルapp barの実高で、日付見出しの吸着位置に
      使う。高さから引く`--player-h`は、鳴らしている間だけ値を持つ。
    */
    <div className="flex flex-col [--app-bar-h:3.75rem] lg:h-[calc(100dvh-4rem-var(--player-h))] lg:min-h-0 lg:flex-row lg:items-stretch lg:gap-6">
      {/*
        desktopではページヘッダーを置かない設計 (docs/design.md §7.1) だが、
        ページには必ずlevel-1見出しが要る。視覚には出さず、支援技術へだけ渡す。
      */}
      <h1 className="sr-only">ライブラリ</h1>
      <div
        className={cn(
          "lg:min-h-0 lg:w-[360px] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain xl:w-[400px]",
          hasSelection && "hidden lg:block"
        )}
      >
        <EpisodeList
          onSelect={selectEpisode}
          selectedEpisodeId={search.episode}
        />
      </div>
      <div
        className={cn(
          "flex flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain",
          !hasSelection && "hidden lg:flex"
        )}
        // 位置が戻ることをe2eで確かめるための目印。スクロールしているのは
        // 中身ではなくこの枠なので、検査もここへ当てる。
        data-detail-pane=""
        ref={detailPaneRef}
      >
        <Panel fallback={<EpisodeDetailSkeleton />} name="episode-detail">
          {search.episode === undefined ? (
            <EmptySelection />
          ) : (
            // 別の番組は別のインスタンス。切り替えはnavigate (=Transition) の
            // 中で起きるので、次の番組が揃うまで前の番組が表示され続ける。
            <EpisodeDetail
              episodeId={search.episode}
              key={search.episode}
              onBack={() => selectEpisode(undefined)}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
