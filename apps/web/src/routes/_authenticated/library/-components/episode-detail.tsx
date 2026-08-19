import { ArrowLeft, Headphones } from "lucide-react"
import { useEffect, useRef } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useEpisodeDetail } from "../-hooks/use-episode-detail"
import { episodeMetaLabel } from "../-model"
import { EpisodePlayButton } from "./episode-play-button"
import { EpisodeScript } from "./episode-script"
import { EpisodeSources } from "./episode-sources"

/**
 * 選択中の番組。`key={episodeId}`でマウントされる前提なので、番組が変われば
 * このインスタンスごと入れ替わる。
 */
export function EpisodeDetail({
  episodeId,
  onBack,
}: {
  readonly episodeId: string
  readonly onBack: () => void
}) {
  const episode = useEpisodeDetail(episodeId)
  const focusRef = useSingleColumnFocus(episodeId)

  return (
    /*
      `self-start`は右レールの吸着のためにある。この枠はスクロール領域(flex)の
      子なので、既定では領域の高さまで引き伸ばされ、追従できる範囲が1画面ぶんで
      尽きる。高さを中身へ戻し、台本の長さいっぱいまで動けるようにする。
    */
    <div className="flex w-full gap-6 self-start">
      <article
        aria-label={episode.title}
        className="flex w-full min-w-0 max-w-3xl flex-col gap-4 outline-none"
        ref={focusRef}
        tabIndex={-1}
      >
        <Button
          className="self-start lg:hidden"
          onClick={onBack}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          一覧へ戻る
        </Button>

        <header className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {episode.title}
          </h2>
          <p className="text-sm text-muted-foreground">
            {episodeMetaLabel(episode)}
          </p>
          {/*
            再生の操作はここと画面下端のバーの2箇所にある。ここは「この番組を
            鳴らし始める」ための入口で、鳴り始めた後の操作はバーが持つ。
          */}
          <EpisodePlayButton
            className="self-start"
            episode={episode}
            labelled
          />
        </header>

        {/* 右レールが入らない幅では、出典を台本の前に畳んで置く。 */}
        <EpisodeSources
          className="xl:hidden"
          defaultOpen={false}
          sources={episode.sources}
        />

        <EpisodeScript script={episode.script} />
      </article>

      {/*
        幅に余裕がある時だけ、追従する出典を右へ出す。同じ名前の`nav`が2つ
        露出しないよう、出し分けは`display:none`で行う (axe: landmark-unique)。
      */}
      <div className="sticky top-4 hidden max-h-[calc(100dvh-8rem)] w-64 shrink-0 self-start overflow-y-auto overscroll-contain xl:block">
        <EpisodeSources sources={episode.sources} />
      </div>
    </div>
  )
}

/**
 * 1カラム時 (lg未満) は番組を開くと一覧が画面から消えるので、読み上げと
 * キーボードの現在地を詳細へ移す。2カラム時はj/kで送り続けられるよう、
 * フォーカスを奪わない。
 */
function useSingleColumnFocus(episodeId: string) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const twoColumn = window.matchMedia?.("(min-width: 64rem)").matches ?? true
    if (!twoColumn) ref.current?.focus()
  }, [episodeId])

  return ref
}

export function EpisodeDetailSkeleton() {
  return (
    <div
      aria-label="番組を読み込み中"
      className="flex w-full max-w-3xl flex-col gap-4"
      role="status"
    >
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-11 w-28 rounded-lg" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function EmptySelection() {
  return (
    <Empty className="h-full w-full rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Headphones aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>番組を選ぶと、原稿と出典が表示されます</EmptyTitle>
        <EmptyDescription>
          再生ボタンで鳴らしながら読めます。j / k で番組を送れます。
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
