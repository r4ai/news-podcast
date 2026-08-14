import { cn } from "@workspace/ui/lib/utils"

import { stateTabs, type ArticleFacets, type ArticleState } from "../-model"

export type ArticleStateTabsProps = {
  readonly value: ArticleState
  readonly facets: ArticleFacets | undefined
  readonly onChange: (state: ArticleState) => void
}

function tabCount(facets: ArticleFacets | undefined, state: ArticleState) {
  return facets?.states[state]
}

/**
 * 状態の絞り込み。見た目はセグメンテッドコントロールで、選択中の面だけが
 * 滑って移動する。
 *
 * ARIA上は`tab`ではなく押下状態を持つボタン群にする。切り替わるのは同じ一覧の
 * 絞り込み条件であって、対応する`tabpanel`が別々に存在するわけではないため。
 *
 * 等幅カラムに割り付けているので、インジケータの位置は選択位置×100%だけで
 * 決まる。幅の実測が要らず、件数の桁が変わってもズレない。
 */
export function ArticleStateTabs({
  value,
  facets,
  onChange,
}: ArticleStateTabsProps) {
  const index = Math.max(
    stateTabs.findIndex((tab) => tab.value === value),
    0
  )

  return (
    <div
      aria-label="記事の状態"
      className="relative grid h-8 grid-cols-4 rounded-lg bg-muted/70 p-0.5 inset-ring inset-ring-border/50"
      role="group"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 rounded-[calc(var(--radius-lg)-2px)] bg-background shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out motion-reduce:transition-none dark:ring-white/10"
        style={{
          width: "calc((100% - 0.25rem) / 4)",
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {stateTabs.map((tab) => {
        const count = tabCount(facets, tab.value)
        const active = tab.value === value
        return (
          <button
            aria-pressed={active}
            className={cn(
              "relative z-10 flex min-w-0 items-center justify-center gap-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              // 非選択の面(muted)の上ではmuted-foregroundが4.5:1を割るので、
              // 前景寄りの薄さで階層を付ける。
              active
                ? "text-foreground"
                : "text-foreground/65 hover:text-foreground"
            )}
            key={tab.value}
            onClick={() => onChange(tab.value)}
            type="button"
          >
            <span className="truncate">{tab.label}</span>
            {count === undefined ? null : (
              // 件数はラベルと同じ色を継ぐ。更に薄めるとどの背景でも基準を割る。
              <span className={cn("tabular-nums", active && "opacity-70")}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
