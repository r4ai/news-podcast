/**
 * 「今日・昨日・今週・それ以前」の括り。
 *
 * 記事一覧と番組一覧が同じ括りを使う。並びの意味は同じなのに、画面ごとに
 * 別の実装を持つと境目の判定がずれる。
 */

export type DateGroupKey = "today" | "yesterday" | "thisWeek" | "older"

export const dateGroupLabels: Record<DateGroupKey, string> = {
  today: "今日",
  yesterday: "昨日",
  thisWeek: "今週",
  older: "それ以前",
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function dateGroupKey(
  iso: string,
  now: Date = new Date()
): DateGroupKey {
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(new Date(iso))) / (24 * 60 * 60 * 1000)
  )
  if (diffDays <= 0) return "today"
  if (diffDays === 1) return "yesterday"
  if (diffDays <= 7) return "thisWeek"
  return "older"
}

export type DateGroup<Item> = {
  readonly key: DateGroupKey
  readonly label: string
  readonly items: readonly Item[]
}

/**
 * 連続する同一グループをまとめる。APIが日時順で返す前提なので単純な走査で足りる。
 */
export function groupByDate<Item>(
  items: readonly Item[],
  timestampOf: (item: Item) => string,
  now: Date = new Date()
): readonly DateGroup<Item>[] {
  const groups: DateGroup<Item>[] = []
  for (const item of items) {
    const key = dateGroupKey(timestampOf(item), now)
    const last = groups.at(-1)
    if (last && last.key === key) {
      groups[groups.length - 1] = { ...last, items: [...last.items, item] }
    } else {
      groups.push({ key, label: dateGroupLabels[key], items: [item] })
    }
  }
  return groups
}
