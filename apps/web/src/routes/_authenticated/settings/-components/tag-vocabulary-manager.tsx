import { Plus, X } from "lucide-react"
import { useState } from "react"

import type { Tag, TagSuggestion } from "@/features/settings"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Empty, EmptyDescription } from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"

import { useTagVocabulary } from "../-hooks/use-tag-vocabulary"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function TagVocabularyManager() {
  const state = useTagVocabulary()
  return <TagVocabularyManagerView {...state} />
}

export type TagVocabularyManagerViewProps = {
  readonly tags: readonly Tag[]
  readonly suggestions: readonly TagSuggestion[]
  readonly isLoading: boolean
  readonly name: string
  readonly pending: boolean
  readonly setName: (value: string) => void
  readonly createTag: () => void
  readonly deleteTag: (tagId: string) => void
  readonly promoteSuggestion: (name: string) => void
}

/**
 * タグ語彙の管理。ここで追加したタグ名だけがAIの候補(enum)になり、
 * ここに無い名前をAIが出したい場合は下のtag_suggestionsへ溜まる
 * （表記ゆれが乱立して絞り込み軸として機能しなくなるのを防ぐ設計。docs/adr参照）。
 */
export function TagVocabularyManagerView({
  tags,
  suggestions,
  isLoading,
  name,
  pending,
  setName,
  createTag,
  deleteTag,
  promoteSuggestion,
}: TagVocabularyManagerViewProps) {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false)
  const visibleSuggestions = showAllSuggestions
    ? suggestions
    : suggestions.slice(0, 8)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>タグ</h2>
        </CardTitle>
        <CardDescription>
          AIはここに登録したタグの中からしか選びません。表記ゆれを防ぐための語彙です。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            createTag()
          }}
        >
          <Input
            aria-label="新しいタグ名"
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            placeholder="新しいタグ名"
            value={name}
          />
          <Button disabled={pending || !name.trim()} type="submit">
            <Plus data-icon="inline-start" />
            追加
          </Button>
        </form>

        {isLoading ? null : tags.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag.id}>
                <Badge className="gap-0.5 pr-0.5" variant="secondary">
                  <span>{tag.name}</span>
                  <Button
                    aria-label={`タグ「${tag.name}」を削除`}
                    className="size-5 rounded-full hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                    disabled={pending}
                    onClick={() => deleteTag(tag.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="border border-dashed py-6">
            <EmptyDescription>
              タグがまだありません。上のフォームから追加してください。
            </EmptyDescription>
          </Empty>
        )}

        {suggestions.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">AIからの提案</h3>
              <Badge variant="outline">{suggestions.length}件</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              語彙に無いためタグ付けを見送った名前です。よく出るものはタグ化すると、
              以後のAI付与に使われます。
            </p>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {visibleSuggestions.map((suggestion) => (
                <li
                  className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5"
                  key={suggestion.name}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {suggestion.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {suggestion.occurrences}回
                  </span>
                  <Button
                    aria-label={`提案「${suggestion.name}」からタグを作成`}
                    className="shrink-0"
                    disabled={pending}
                    onClick={() => promoteSuggestion(suggestion.name)}
                    size="sm"
                    variant="ghost"
                  >
                    作成
                  </Button>
                </li>
              ))}
            </ul>
            {suggestions.length > 8 ? (
              <Button
                aria-label={
                  showAllSuggestions ? "提案を折りたたむ" : "提案をすべて表示"
                }
                className="self-start"
                onClick={() => setShowAllSuggestions((current) => !current)}
                size="sm"
                variant="ghost"
              >
                {showAllSuggestions
                  ? "折りたたむ"
                  : `残り${suggestions.length - 8}件を表示`}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
