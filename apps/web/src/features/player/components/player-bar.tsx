import { useAtomValue, useSetAtom } from "jotai"
import { X } from "lucide-react"
import { useRef } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"

import { useMediaQuery } from "@/shared/lib/use-media-query"

import {
  closePlayerAtom,
  currentTrackAtom,
  playerExpandedAtom,
  type PlayerTrack,
} from "../atoms"
import { EpisodeArtwork } from "./episode-artwork"
import { NowPlayingPanel } from "./now-playing-panel"
import { PlaybackErrorBanner } from "./playback-notice"
import { PlaybackRateSelect } from "./playback-rate-select"
import { PlaybackScrubber } from "./playback-scrubber"
import { TransportControls } from "./transport-controls"
import { VolumeControl } from "./volume-control"

/**
 * 展開した中身のid。畳んでいる間は指す先が無いが、`aria-expanded="false"`が
 * 併記されていれば「今は無い」と読める。
 */
const PANEL_ID = "now-playing-panel"

/**
 * 広い幅の境目。ここを境に**器の形そのもの**が変わるので、CSSでは選べない。
 * 板がその場で伸びるか、下端からDrawerが立ち上がるか。
 */
const WIDE_QUERY = "(min-width: 40rem)"

/**
 * 「押せるもの」の見分け。ここに当たらない場所を押したら開く。
 */
const INTERACTIVE = "a,button,input,select,textarea,[role='slider']"

/**
 * 画面下端に浮かぶ再生バー。
 *
 * routeの外 (`AppShell`) に立っているので、ページを移っても音は途切れない。
 * ここが購読するのは「今どの番組が載っているか」と「開いているか」だけで、
 * 位置・再生状態・速度・音量はそれぞれを描くcomponentが自分で購読する。
 *
 * ## 面の積み方
 *
 * 帯を画面幅いっぱいに敷かず、**縁から浮かせた1枚のglassの板**にする。
 * 下に本文が透けるので、バーが本文を切り落としているのではなく上に載って
 * いることが判る。滲みを持つのはこの板だけで、目盛り・時刻・波はすべて板の
 * **前面** に描く。`backdrop-filter`が読むのは後ろに描かれたものだけなので、
 * 毎秒数回動く目盛りは滲みの計算を呼ばない (docs/design.md §7.2)。
 *
 * ## 開き方
 *
 * 開くための専用ボタンは置かない。**板の押せない場所はどこでも開く**。
 * 常設の行は幅が足りず、ボタンを1つ足すだけで題名が数文字ぶん削れる。
 * キーボードからは題名が開く役を兼ねる。
 */
export function PlayerBar() {
  const track = useAtomValue(currentTrackAtom)
  const expanded = useAtomValue(playerExpandedAtom)
  const setExpanded = useSetAtom(playerExpandedAtom)
  const wide = useMediaQuery(WIDE_QUERY)
  // 畳むときのfocusの行き先。開いた中身は畳んだ瞬間に消えるので、
  // 消えない場所へ先に移す必要がある。
  const titleRef = useRef<HTMLButtonElement>(null)
  /*
    押し始めた指。**どの指が**押せないところから始めたかまで持つ。真偽だけ
    だと、1本目が板の余白を押さえたまま2本目が板の外から入って余白で離れた
    とき、2本目が1本目の印を食べて開いてしまう。
  */
  const pressedPointer = useRef<number | null>(null)
  /*
    原稿へ移って閉じたか。移った先は自分で見出しへfocusを移すので、こちらが
    題名へ引き戻すとその契約を破る。
  */
  const leaving = useRef(false)
  if (track === null) return null

  /**
   * 畳む。**畳む前にfocusを題名へ移す**。
   *
   * 音量・速度・原稿へのリンクはいずれも開いた中身にある。focusを持ったまま
   * 消えると、行き先を失ったfocusは`body`へ落ちる。キーボードだけで使う
   * 利用者は、そこからページの先頭を辿り直すことになる。
   */
  const collapse = () => {
    /*
      板がその場で伸びる幅では、消える中身からfocusを先に逃がす。Drawerの
      幅では効かない(modalが背面をinertにしている)ので、行き先は
      `finalFocus`へ預けてある。
    */
    if (wide) titleRef.current?.focus()
    setExpanded(false)
  }

  return (
    <div
      aria-label="再生中の番組"
      className={cn(
        // モバイルは下部ナビの上へ浮かせる。ナビの実高は`--app-nav-h`が持つ。
        "fixed inset-x-0 bottom-[calc(var(--app-nav-h)+0.5rem)] z-30 px-2 md:bottom-3",
        /*
          板は**画面の中央**へ置く。主領域(サイドバーの右)の中央に置くと、
          板だけが画面全体の中で右へずれて見える。

          ただしサイドバー(14rem)へは掛けない。左右へ同じだけ余白を取り、
          その余白を「中央寄せに必要な量」と「サイドバー＋1rem」の**大きい方**
          にすることで、広い画面では画面中央・狭い画面ではサイドバーの右隣まで、
          どちらも板を左右対称に保ったまま満たせる。

          lgより下ではサイドバーと板が近すぎて板が潰れるので、主領域の中で
          収める従来の置き方に留める。
        */
        "md:pr-4 md:pl-[15rem]",
        "lg:px-[max(15rem,calc(50%-24rem))]",
        // 枠は板の外側の余白でしかない。ここで操作を受けると、板の脇を押した
        // だけで本文の操作が効かなくなる。
        "pointer-events-none"
      )}
      // `AppShell`がこの印を`:has()`で見て、本文末尾の余白を確保する。
      data-slot="player-bar"
      role="region"
    >
      <Collapsible onOpenChange={setExpanded} open={wide && expanded}>
        <div
          className={cn(
            "group/bar glass-surface pointer-events-auto mx-auto w-full max-w-3xl rounded-3xl",
            // 押せない場所はどこでも開く。開いている間は押し所ではない。
            !expanded && "cursor-pointer"
          )}
          // 展開中のEscapeは畳むだけ。閉じる(音を止める)とは別の操作なので
          // 重ねない。板の外へ伝えないのは、記事一覧などの選択解除まで
          // 巻き添えにしないため。
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !expanded) return
            event.stopPropagation()
            collapse()
          }}
          /*
            押せるものの上で始まった操作は、そちらのもの。それ以外は開く。
            文字を選んでいる最中も開かない (選択が消えて読めなくなる)。

            速度の候補はportalで板の外へ出る。Reactの出来事はportalを跨いで
            ここまで上がってくるので、**DOMの中に在るかどうか**で切る。
            名札 (`role`) で切ると漏れる: 候補は`option`で`INTERACTIVE`に
            当たらず、速度を選んだだけで板が開き、しかもその拍子に候補を
            抱えた列ごと消えて選択まで失われていた。
          */
          onPointerDown={(event) => {
            /*
              **押し始めた場所**を覚える。離した場所だけで決めると、再生や
              閉じるを押してから指をずらして板の余白で離したとき、そちらの
              `click`は取り消されるのにこちらだけが開く。操作はそれを始めた
              ものに属する (docs/design.md §7.1)。
            */
            /*
              既に1本が押さえているなら、後から触れた指は数えない。上書き
              すると、先に離した1本目は所有者でないので開かず、その直後に
              1本目の後始末が印を降ろすので2本目も開かない。どちらの操作も
              押せないところから始まったのに、両方とも失われる。
            */
            if (pressedPointer.current !== null) return
            const target = event.target as Element
            const onSurface =
              event.button === 0 &&
              event.currentTarget.contains(target) &&
              target.closest(INTERACTIVE) === null
            if (!onSurface) return
            pressedPointer.current = event.pointerId
            /*
              印は**指がどこで離れても降ろす**。板の上で離れなかった場合
              (押したまま板の外へ出て離す) はこの要素の`pointerup`が呼ばれず、
              印が立ちっぱなしになる。次に板の外で始まった操作が板の余白で
              離れると、その印を食べて開いてしまう。

              窓の`pointerup`はReactの`onPointerUp`より後に届くので、開くか
              どうかの判断を先に済ませてから降ろせる。
            */
            const id = event.pointerId
            const clear = (ended: PointerEvent) => {
              if (ended.pointerId !== id) return
              pressedPointer.current = null
              globalThis.removeEventListener("pointerup", clear)
              globalThis.removeEventListener("pointercancel", clear)
            }
            globalThis.addEventListener("pointerup", clear)
            globalThis.addEventListener("pointercancel", clear)
          }}
          onPointerUp={(event) => {
            const started = pressedPointer.current === event.pointerId
            if (started) pressedPointer.current = null
            if (!started || expanded) return
            const target = event.target as Element
            if (!event.currentTarget.contains(target)) return
            if (target.closest(INTERACTIVE) !== null) return
            if ((getSelection()?.toString().length ?? 0) > 0) return
            setExpanded(true)
          }}
        >
          {/*
            Drawerで開いている間は出さない。覆われて触れないうえ、同じ
            `role="alert"`が画面に2つ在ることになる。向こうが引き受ける。
          */}
          {wide || !expanded ? <PlaybackErrorBanner /> : null}

          {/* 広い幅では、板がその場で伸びる。 */}
          <CollapsibleContent
            className={cn(
              "overflow-hidden",
              "h-[var(--collapsible-panel-height)] transition-[height] duration-300 ease-apple",
              "data-starting-style:h-0 data-ending-style:h-0 motion-reduce:transition-none"
            )}
          >
            {/*
              `expanded`では切らない。畳んだ描画で中身が先に消えると、外側が
              300msかけて縮む間、空の枠だけが残る。出し入れは`Collapsible`が
              終了の遷移まで面倒を見るので、ここは幅だけで決める。
            */}
            {wide ? (
              <NowPlayingPanel
                /*
                  高さに上限を置く。板の上へ伸びるこの段は、下端に浮く他の
                  案内(回線切れ・生成キュー)が避ける先を決めるので、
                  **どこまで伸びうるかが判っている**必要がある。超えた分は
                  この中でスクロールさせる。
                */
                className="max-h-52 overflow-y-auto overscroll-contain px-5 pt-4 pb-1"
                data-slot="player-expanded"
                id={PANEL_ID}
                track={track}
                withHeader={false}
              />
            ) : null}
          </CollapsibleContent>

          {/*
            常設の行。**子の位置は開閉で変えない**。押し所が段の間で動くと、
            押した瞬間にその要素ごと作り直されてfocusが本文の先頭へ落ちる。
          */}
          <div
            className={cn(
              /*
                目盛りが縁に居る狭い幅だけ、掴み代(16px)のぶん上を空ける。
                空けないと、幅いっぱいに広がる帯が再生や閉じるの上端を覆い、
                そこを押すとシークする(実測: 再生ボタンの上8px)。smからは
                目盛りが行の中へ入るので要らない。
              */
              "relative flex items-center gap-2 px-2 pt-4 pb-2 sm:px-3 sm:pt-2"
            )}
          >
            <EpisodeArtwork className="size-11" episodeId={track.episodeId} />
            <TrackSummary
              expanded={expanded}
              onToggle={() => (expanded ? collapse() : setExpanded(true))}
              ref={titleRef}
              track={track}
            />
            <TransportControls />
            {/*
              広い幅では、速度と音量を開かずに触れる。音量はアイコンだけを置き、
              押すとその場へ帯が重なって開く。帯を常に並べると、常設の行で
              最も長く取りたい題名から80px以上を奪う。

              開いている間は出さない。開いた中身が同じものを帯として持つので、
              残すと同じ名前の操作が画面に2つ並ぶ。
            */}
            {expanded ? null : (
              <div className="hidden items-center gap-1 lg:flex">
                <PlaybackRateSelect />
                <VolumeControl variant="popover" />
              </div>
            )}
            <CloseButton />
          </div>
        </div>
      </Collapsible>

      {/*
        狭い幅では、下端から立ち上がるDrawerにする。板の中でその場に伸ばすと、
        画面の半分近くを占める中身が下部ナビと本文の隙間へ押し込まれ、どこから
        来た面なのかも判らない。
      */}
      <Sheet
        onOpenChange={(open) => (open ? setExpanded(true) : collapse())}
        open={!wide && expanded}
      >
        <SheetContent
          /*
            閉じた後のfocusの行き先。Drawerが立っている間、背面の板はmodalが
            inertにしているので、こちらから`focus()`しても効かない。行き先を
            預けて、**modalが閉じ切ってから**戻してもらう。
          */
          /*
            閉じた後のfocusの行き先。Drawerが立っている間、背面の板はmodalが
            inertにしているので、こちらから`focus()`しても効かない。行き先を
            預けて、**modalが閉じ切ってから**戻してもらう。

            ただし原稿へ移って閉じた場合は戻さない。移った先が自分で現在地を
            詳細へ移すので、そこから奪い返すことになる。
          */
          finalFocus={() => {
            if (!leaving.current) return titleRef.current
            leaving.current = false
            return false
          }}
          onDismiss={collapse}
          className={cn(
            "glass-surface pointer-events-auto border-x-0 border-b-0",
            /*
              Drawerだけ面を濃くする。板は本文の「上に少し載る」帯なので薄くて
              良いが、こちらは画面の3割を覆って補助文まで載せる。薄いままだと、
              後ろの本文が透けて文字のコントラストが基準(4.5:1)を割る
              (実測: 日付・原稿への道・残り時間の3か所でaxeが落ちた)。
            */
            "[--glass-bg:oklch(1_0_0_/_90%)] dark:[--glass-bg:oklch(0.24_0_0_/_92%)]",
            /*
              補助文も、この面の上に立つ値へ引き上げる。`--muted-foreground`は
              白の上でちょうど4.6:1で、透過が少しでも入ると基準の4.5:1を割る
              (実測: 90%の面で4.42)。面の濃さだけで詰めると、今度は透ける意味が
              無くなる。**この面の上でだけ**余裕のある値にする。
            */
            "[--muted-foreground:oklch(0.47_0_0)] dark:[--muted-foreground:oklch(0.72_0_0)]"
          )}
        >
          <SheetTitle className="sr-only">再生中の番組</SheetTitle>
          <SheetDescription className="sr-only">
            再生位置・速度・音量を変えられます。
          </SheetDescription>
          <NowPlayingPanel
            id={PANEL_ID}
            onNavigate={() => {
              leaving.current = true
              collapse()
            }}
            track={track}
            withTransport
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}

/**
 * 何を鳴らしていて、どこまで来たか。
 *
 * 題名は**開く役を兼ねる**。専用のボタンを置くと、常設の行で最も長く取り
 * たい題名からそのぶんの幅が削れる。キーボードからはここがその入口になる。
 * 原稿への道は開いた先にある。
 */
function TrackSummary({
  expanded,
  onToggle,
  ref,
  track,
}: {
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly ref: React.Ref<HTMLButtonElement>
  readonly track: PlayerTrack
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <button
        aria-controls={PANEL_ID}
        aria-expanded={expanded}
        className="truncate rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onToggle}
        ref={ref}
        title={track.title}
        type="button"
      >
        {track.title}
      </button>
      {/*
        2行目は「どこまで来たか」。`sm`からはこの行がそのまま実目盛りになり、
        それ未満では目盛りだけが板の上端の縁へ逃げて、ここは時刻の文字を担う。
        置き場所の切り替えは`PlaybackScrubber`の中に閉じている。
        開いている間は出さない。開いた中身が大きい目盛りを持つので、残すと
        同じ名前の目盛りが2つ並ぶ。
      */}
      {expanded ? null : <PlaybackScrubber />}
    </div>
  )
}

function CloseButton() {
  const close = useSetAtom(closePlayerAtom)

  return (
    <Button
      aria-label="再生を終了してバーを閉じる"
      className="size-9 shrink-0 rounded-full"
      onClick={() => close()}
      size="icon-lg"
      variant="ghost"
    >
      <X aria-hidden="true" />
    </Button>
  )
}
