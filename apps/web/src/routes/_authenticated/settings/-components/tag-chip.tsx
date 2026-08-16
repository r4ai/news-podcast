import { X } from "lucide-react"

import type { Tag } from "@/features/settings"
import { Button } from "@workspace/ui/components/button"

/**
 * 登録済みのタグ1件。
 *
 * 削除は行ごとの独立した操作なので、当たり判定もチップの高さいっぱいに取る。
 * モバイルでは44px、desktopでは密度を優先して24pxにする (docs/design.md §7.1)。
 *
 * 描画範囲の予算 (`tag-vocabulary.render-count.test.tsx`) がこの単位で数える
 * ため、別moduleに置いてある。
 */
export function TagChip({
  onDelete,
  pending,
  tag,
}: {
  readonly tag: Tag
  readonly pending: boolean
  readonly onDelete: () => void
}) {
  return (
    <li>
      <span className="flex h-11 items-center gap-1 rounded-full border bg-muted/40 pr-1 pl-3 text-sm md:h-8">
        {/* 語彙名は省略しない。長いタグ名は折り返さず、行が増える方を選ぶ。 */}
        <span className="whitespace-nowrap">{tag.name}</span>
        <Button
          aria-label={`タグ「${tag.name}」を削除`}
          className="h-full w-11 rounded-full hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive md:size-6"
          disabled={pending}
          onClick={onDelete}
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      </span>
    </li>
  )
}
