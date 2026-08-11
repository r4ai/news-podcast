import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import type { ArticleSource } from "../-model"

export type ArticleSourceTabsProps = {
  readonly source: ArticleSource
  readonly onSourceChange: (source: ArticleSource) => void
}

const sourceLabels: Record<ArticleSource, string> = {
  markdown: "本文",
  archive: "アーカイブ",
}

/** 本文/アーカイブの2段切り替え。元記事は`ArticleActions`の外部リンクとして扱う。 */
export function ArticleSourceTabs({
  source,
  onSourceChange,
}: ArticleSourceTabsProps) {
  return (
    <ToggleGroup
      aria-label="表示ソース"
      onValueChange={(value) => {
        const [next] = value
        if (next) onSourceChange(next as ArticleSource)
      }}
      value={[source]}
    >
      {(Object.keys(sourceLabels) as ArticleSource[]).map((value) => (
        <ToggleGroupItem key={value} value={value}>
          {sourceLabels[value]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
