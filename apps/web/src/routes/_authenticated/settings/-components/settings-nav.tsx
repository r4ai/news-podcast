import { Link } from "@tanstack/react-router"
import { BookA, Sparkles, Tags } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { SettingsSection } from "../-model"

type SectionLink = {
  readonly section: SettingsSection
  readonly label: string
  readonly icon: LucideIcon
}

export const sectionLinks: readonly SectionLink[] = [
  { section: "ai", label: "興味とAI処理", icon: Sparkles },
  { section: "tags", label: "タグ語彙", icon: Tags },
  { section: "dictionary", label: "読み辞書", icon: BookA },
]

/**
 * 設定の中の行き先。
 *
 * 3つの項目は扱う対象がまるで違う（AIへの指示 / 語彙 / 読み）のに、以前は
 * 1本のスクロールへ積んであった。読み辞書を1件直すために興味プロフィールと
 * タグ全部を通り過ぎる必要があり、登録が増えるほど遠くなる。項目を分けて、
 * 開いている場所だけに幅と高さを全部渡す。
 *
 * `<nav>`は1つだけ描き、狭い時は横並び、`lg`から縦のレールにする。
 * 同じラベルの`<nav>`を2つ置くと、支援技術からはどちらも「設定の項目」に
 * 見え、axeの`landmark-unique`にも触れる。
 */
export function SettingsNav({
  current,
}: {
  readonly current: SettingsSection
}) {
  return (
    <nav
      aria-label="設定の項目"
      className="-mx-1 shrink-0 overflow-x-auto px-1 pb-1 lg:sticky lg:top-6 lg:mx-0 lg:w-48 lg:overflow-visible lg:px-0 lg:pb-0"
    >
      <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
        {sectionLinks.map(({ icon: Icon, label, section }) => {
          const active = section === current
          return (
            <li key={section}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:min-h-10 lg:w-full",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                search={{ section }}
                to="/settings"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
