import { Clock3, Headphones, House, Library, Rss } from "lucide-react"
import type { PropsWithChildren } from "react"

import { Link, useMatchRoute } from "@tanstack/react-router"
import { buttonVariants } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { ThemeToggle } from "@/components/theme-toggle"

const links = [
  { to: "/", label: "今日", icon: House },
  { to: "/subscriptions", label: "購読", icon: Rss },
  { to: "/schedule", label: "生成時刻", icon: Clock3 },
  { to: "/library", label: "ライブラリ", icon: Library },
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
      className={mobile ? "grid grid-cols-4 gap-1" : "flex flex-col gap-1"}
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

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r bg-background p-4 md:flex md:flex-col md:gap-6">
        <Brand />
        <Navigation />
        <div className="mt-auto flex justify-end">
          <ThemeToggle />
        </div>
      </aside>

      <header className="sticky top-0 flex items-center justify-between border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden">
        <Brand />
        <ThemeToggle />
      </header>

      <main className="pb-24 md:ml-56 md:pb-0">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <Navigation mobile />
      </div>
    </div>
  )
}

export function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="h-8 w-28" />
    </div>
  )
}
