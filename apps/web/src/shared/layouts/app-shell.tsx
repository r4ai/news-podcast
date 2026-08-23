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
    */
    <div className="min-h-svh bg-background text-foreground [--app-nav-h:calc(3rem+max(0.5rem,env(safe-area-inset-bottom)))] [--player-h:0rem] [&:has([data-slot=player-bar])]:[--player-h:6rem] md:[&:has([data-slot=player-bar])]:[--player-h:5.5rem]">
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
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r bg-background p-4 md:flex md:flex-col md:gap-6 md:pb-[calc(var(--player-h)+1rem)]">
        <Brand />
        <Navigation />
        <div className="mt-auto flex justify-end">{actions}</div>
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
        // 下端に居座るもの (モバイルのナビ・再生バー) の分だけ本文の末尾を空ける。
        className="pb-[calc(var(--app-nav-h)+var(--player-h)+1rem)] md:ml-56 md:pb-[calc(var(--player-h)+1rem)]"
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

      {player}

      {/*
        背景は透かさない。この帯のすぐ上に再生バーが載り、その中の目盛りは
        鳴っている間ずっと動く。backdrop-filterを持つ面が隣接していると、
        目盛りが動くたびにこの帯まで描き直される (docs/design.md §7.2)。
      */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        <Navigation mobile />
      </div>
    </div>
  )
}
