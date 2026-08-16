import type { ComponentPropsWithoutRef } from "react"

import {
  Table as UiTable,
  TableBody as UiTableBody,
  TableCell as UiTableCell,
  TableHead as UiTableHeaderCell,
  TableHeader as UiTableHeader,
  TableRow as UiTableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"

/**
 * shadcn/uiのTableへ寄せる。`Table`は`overflow-x-auto`の入れ物を内包するので、
 * ページ本体を横スクロールさせないという要件をそのまま満たす。外側の枠と余白は
 * 本文の他のブロック(コードブロックや図版)と揃えるためここで足す。
 *
 * 幅を`w-max min-w-full`にするのは、`w-full`だと列数の多い表で各列が潰れて
 * 折り返しだらけになるため。内容が収まる幅まで伸ばし、溢れた分だけを
 * 入れ物側で横スクロールさせる。
 */
export function Table({
  className,
  ...props
}: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="my-4 w-full rounded-md border border-border">
      <UiTable className={cn("w-max min-w-full", className)} {...props} />
    </div>
  )
}

export function TableHead(props: ComponentPropsWithoutRef<"thead">) {
  return <UiTableHeader className="bg-muted" {...props} />
}

export function TableBody(props: ComponentPropsWithoutRef<"tbody">) {
  return <UiTableBody {...props} />
}

export function TableRow(props: ComponentPropsWithoutRef<"tr">) {
  return <UiTableRow {...props} />
}

/**
 * shadcnの既定は`whitespace-nowrap`(データテーブル向け)。本文中の表は
 * 日本語の文章が入るので、折り返す方が読める。
 */
export function TableHeaderCell({
  className,
  ...props
}: ComponentPropsWithoutRef<"th">) {
  return (
    <UiTableHeaderCell
      className={cn(
        "h-auto border border-border px-3 py-2 font-semibold whitespace-normal",
        className
      )}
      {...props}
    />
  )
}

export function TableCell({
  className,
  ...props
}: ComponentPropsWithoutRef<"td">) {
  return (
    <UiTableCell
      className={cn(
        "border border-border px-3 py-2 whitespace-normal",
        className
      )}
      {...props}
    />
  )
}
