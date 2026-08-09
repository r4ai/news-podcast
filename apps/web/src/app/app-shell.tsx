import { Headphones } from "lucide-react"
import type { PropsWithChildren } from "react"

import { Link } from "@tanstack/react-router"

const links = [
  ["/", "今日"],
  ["/subscriptions", "購読"],
  ["/schedule", "生成時刻"],
  ["/library", "ライブラリ"],
] as const

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link className="flex items-center gap-2 font-semibold" to="/">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Headphones className="size-4" />
            </span>
            News Podcast
          </Link>
          <nav
            aria-label="メインナビゲーション"
            className="flex gap-1 overflow-x-auto"
          >
            {links.map(([to, label]) => (
              <Link
                activeProps={{ className: "bg-muted text-foreground" }}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground"
                key={to}
                to={to}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}

export function PanelSkeleton() {
  return <div className="h-36 animate-pulse rounded-2xl border bg-muted" />
}
