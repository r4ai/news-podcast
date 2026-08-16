import { useAtomValue, useSetAtom } from "jotai"
import { Search, X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { useDebouncedCallback } from "@/shared/lib/use-debounced-callback"
import { articleSearchDraftAtom, displayedSearchQuery } from "../-atoms"
import { ARTICLE_SEARCH_INPUT_ID } from "../-hooks/use-article-keyboard-shortcuts"

const SEARCH_DEBOUNCE_MS = 300

export type ArticleSearchFieldProps = {
  /** URL上の確定した検索語。下書きの基準になる。 */
  readonly q: string
  readonly onCommit: (value: string) => void
}

/**
 * 検索欄。打鍵で描き直されるのはこのcomponentだけ。
 *
 * 下書きはatomが持ち、確定値はURLが持つ。打鍵のたびに親へ状態を持ち上げると、
 * 一覧の全行までが描き直しの対象になる。表示する文字列は下書きとURLから
 * 導けるので、両者を突き合わせるstateも要らない。
 */
export function ArticleSearchField({ q, onCommit }: ArticleSearchFieldProps) {
  const draft = useAtomValue(articleSearchDraftAtom)
  const setDraft = useSetAtom(articleSearchDraftAtom)
  const value = displayedSearchQuery(draft, q)

  // 打鍵ごとにURLを書き換えると履歴と再取得が溢れる。頻度の制限であって
  // 描画の優先度の話ではないので、デバウンスで扱う (ADR-0047)。
  const commit = useDebouncedCallback(onCommit, SEARCH_DEBOUNCE_MS)

  function change(next: string) {
    setDraft({ base: q, value: next })
    commit(next)
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        aria-label="記事を検索"
        className="h-8 bg-background/60 pr-8 pl-8"
        id={ARTICLE_SEARCH_INPUT_ID}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") change("")
        }}
        placeholder="タイトルや本文で検索"
        value={value}
      />
      {value ? (
        <Button
          aria-label="検索条件を消す"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onClick={() => change("")}
          size="icon-xs"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}
