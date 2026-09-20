import {
  Clock3,
  Headphones,
  House,
  Library,
  Newspaper,
  Rss,
  Settings,
} from "lucide-react"
import type { ReactNode } from "react"

import { Link, useLocation, useMatchRoute } from "@tanstack/react-router"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { KeyboardShortcutsHelp } from "@/shared/components/keyboard-shortcuts-help"
import { OfflineNotice } from "@/shared/components/offline-notice"

const links = [
  { to: "/", label: "今日", icon: House },
  { to: "/articles", label: "記事", icon: Newspaper },
  { to: "/subscriptions", label: "購読", icon: Rss },
  { to: "/schedule", label: "生成時刻", icon: Clock3 },
  { to: "/library", label: "ライブラリ", icon: Library },
  { to: "/settings", label: "設定", icon: Settings },
] as const

function Brand() {
  return (
    <Link
      className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      to="/"
    >
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Headphones aria-hidden="true" />
      </span>
      News Podcast
    </Link>
  )
}

function Navigation({ mobile = false }: { readonly mobile?: boolean }) {
  const matchRoute = useMatchRoute()

  return (
    <nav
      aria-label={mobile ? "モバイルナビゲーション" : "メインナビゲーション"}
      className={mobile ? "grid grid-cols-6 gap-1" : "flex flex-col gap-1"}
    >
      {links.map(({ icon: Icon, label, to }) => {
        const active = Boolean(matchRoute({ to, fuzzy: to !== "/" }))
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={buttonVariants({
              variant: active ? "secondary" : "ghost",
              size: "lg",
              className: mobile
                ? "min-h-11 flex-col gap-1 px-1 text-[0.6875rem]"
                : "min-h-11 justify-start gap-3 px-3",
            })}
            key={to}
            to={to}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

type AppShellProps = {
  /** ナビゲーション末尾へ差し込む操作。テーマ切替などをrouteから渡す。 */
  readonly actions?: ReactNode
  /**
   * ページを跨いで居座る再生バー。routeの外に置くための差し込み口で、
   * 高さの確保はこのcomponentが`:has()`で行う (下の`--player-h`)。
   */
  readonly player?: ReactNode
  readonly children: ReactNode
}

/** 一覧+本文の2ペインを組むページ。主領域の幅上限を外す (docs/design.md §7.1)。 */
const WIDE_PATHS = ["/articles", "/library"] as const

export function AppShell({ actions, children, player }: AppShellProps) {
  const isWide = useLocation({
    select: (location) =>
      WIDE_PATHS.some((path) => location.pathname.startsWith(path)),
  })

  return (
    /*
      下端に居座るものの高さを、ここで一度だけ宣言する。
      `--player-h`は再生バーが実際に立っている時だけ値を持つ。バーの有無を
      stateで配ると、鳴らし始めた瞬間に画面全体が描き直されるので、DOMに
      在るかどうか (`:has`) で決める。

      確保するのは**折りたたんだ板と、その下の浮きしろ**だけ。展開した段は
      板の上へ伸びる覆いなので、ここへは足さない。足すと、開閉のたびに本文が
      1段ぶん跳ねる。

      例外は再生の失敗を告げる行(`player-error`)。これは板の高さそのものを
      変え、しかも**この直後に置く回線切れの案内がちょうどその行へ重なる**。
      失敗は稀なので、出ている間だけ確保を厚くする。`:has()`を2つ重ねて、
      上の宣言より詳細度を高くしている(出力順に依存させない)。
    */
    <div className="min-h-svh bg-background text-foreground [--app-nav-h:calc(3rem+max(0.5rem,env(safe-area-inset-bottom)))] [--player-h:0rem] [&:has([data-slot=player-bar])]:[--player-h:5rem] [&:has([data-slot=player-bar]):has([data-slot=player-error])]:[--player-h:7.75rem] [--player-notice-h:var(--player-h)] [&:has([data-slot=player-expanded])]:[--player-notice-h:18rem]">
      {/*
        キーボードだけで使う場合、ページを開くたびに6本のナビゲーションを
        通り抜けないと本文へ入れない。最初のTabで本文へ飛べる出口を置く。
        普段は視界から外し、focusされたときだけ現れる。
      */}
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none focus:ring-3 focus:ring-ring/50"
        href="#main-content"
      >
        本文へスキップ
      </a>
      {/*
        再生バーの高さは**引かない**。板はサイドバーの右隣までしか来ないので、
        ここで空けるとログアウトなどの末尾の操作だけが、何にも隠されていない
        まま1段浮いて止まる。
      */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r bg-background p-4 md:flex md:flex-col md:gap-6">
        <Brand />
        <Navigation />
        {/*
          キー操作の目録は`actions`ではなくここが持つ。routeから配ると、
          ページごとに渡し忘れる余地ができる。開閉の状態はこのcomponentの
          中に閉じているので、開いてもページは描き直されない。
        */}
        <div className="mt-auto flex items-center justify-end gap-1">
          <KeyboardShortcutsHelp />
          {actions}
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden">
        <Brand />
        {actions}
      </header>

      {/*
        スキップリンクの着地点。`tabIndex={-1}`が無いとfocusを受け取れず、
        以降のTabが本文からではなくページ先頭から再開してしまう。
      */}
      <main
        /*
          下端に居座るもの (モバイルのナビ・再生バー) の分だけ本文の末尾を空ける。

          ただし2ペインのページは別。あちらは自分で画面の高さいっぱいの枠を
          組み、その中で独立にスクロールする。ここで末尾を空けると、枠の下に
          板1枚ぶんの何も無い帯ができて、内容が画面の下まで届かなくなる。
          板は透ける面として**内容の上に浮く**ので、退ける必要がない。
          最後の行が板の下に隠れないよう、余白はスクロールする側が持つ。
        */
        className={cn(
          "md:ml-56",
          "pb-[calc(var(--app-nav-h)+var(--player-h)+1rem)] md:pb-[calc(var(--player-h)+1rem)]",
          /*
            外すのは**2ペインが立ち上がる`lg`から**。`md`〜`lg`ではあちらも
            まだ1カラムで、画面の高さいっぱいの枠も枠内の余白も持たない。
            ここで先に外すと、その幅だけ最後の行が板の下から出てこない。
          */
          isWide && "lg:pb-0"
        )}
        id="main-content"
        tabIndex={-1}
      >
        <div
          className={cn(
            "mx-auto flex flex-col gap-6 p-4 sm:p-6 lg:p-8",
            isWide ? "max-w-none" : "max-w-6xl"
          )}
        >
          {children}
        </div>
      </main>

      {/*
        回線切れの案内。下端に居座るものの**すぐ上**へ重ねる。
        本文の流れに入れると、記事・ライブラリが吸着の基準にしている
        `--app-bar-h`が実際の高さとずれて、日付見出しがヘッダーへ潜る。

        逃げ先は`--player-h`ではなく`--player-notice-h`。板を開くと上へ伸びる
        が、本文の確保(`--player-h`)は増やさない(増やすと開閉のたびに本文が
        跳ねる)。この案内は板より手前に浮くので、確保と同じ値で置くと開いた
        段の速度・音量の行をちょうど覆う(実測: 通知691..720が速度689..721)。
      */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--app-nav-h)+var(--player-notice-h))] z-40 md:bottom-[var(--player-notice-h)]">
        <OfflineNotice />
      </div>

      {player}

      {/*
        背景は透かさない。再生バーはこの帯より手前(z-30)に浮いているので、
        バーの中で毎秒動く目盛りは**この帯の背後には来ない**。それでもここを
        透かすと、滲みが読むのは本文になり、スクロールのたびに下端の帯全体を
        計算し直すことになる (docs/design.md §7.2)。
      */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        <Navigation mobile />
      </div>
    </div>
  )
}
