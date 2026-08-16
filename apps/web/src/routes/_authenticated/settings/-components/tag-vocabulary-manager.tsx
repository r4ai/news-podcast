import { useAtomValue } from "jotai"
import { Lightbulb, Plus, Search, Tags } from "lucide-react"
import { useDeferredValue, useState } from "react"

import type { Tag, TagSuggestion } from "@/features/settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription } from "@workspace/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { AtomInput } from "@/shared/ui/atom-input"
import { canAddTagAtom, tagNameDraftAtom } from "../-atoms"
import { useTagVocabulary } from "../-hooks/use-tag-vocabulary"
import { SettingsSection } from "./settings-section"
import { TagChip } from "./tag-chip"

/** これを超えたら、目で探すより打って絞る方が速い。 */
const SEARCH_THRESHOLD = 8

/** 下書きの中身を購読するのはこのボタンだけ。 */
function AddTagButton({ pending }: { readonly pending: boolean }) {
  const canAdd = useAtomValue(canAddTagAtom)

  return (
    <Button className="h-11 md:h-9" disabled={pending || !canAdd} type="submit">
      <Plus data-icon="inline-start" />
      追加
    </Button>
  )
}

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function TagVocabularyManager() {
  const state = useTagVocabulary()
  return <TagVocabularyManagerView {...state} />
}

export type TagVocabularyManagerViewProps = {
  readonly tags: readonly Tag[]
  readonly suggestions: readonly TagSuggestion[]
  readonly isLoading: boolean
  readonly pending: boolean
  readonly createTag: () => void
  readonly deleteTag: (tagId: string) => void
  readonly promoteSuggestion: (name: string) => void
}

// 相対表記("3日前")は毎日変わり、視覚回帰の基準画像を壊す。絶対日付で出す。
const dateLabel = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
})

/**
 * AIが出したがった、語彙に無い名前。
 *
 * 出現回数と最後に見た日を添える。「よく出るから採る」「一度きりだから見送る」
 * の判断は、その2つが無いとできない。名前は省略しない。
 */
function SuggestionRow({
  onPromote,
  pending,
  suggestion,
}: {
  readonly suggestion: TagSuggestion
  readonly pending: boolean
  readonly onPromote: () => void
}) {
  return (
    <li className="flex items-center gap-3 py-2 not-last:border-b">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm wrap-anywhere">{suggestion.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {suggestion.occurrences}回 ・ 最終
          {dateLabel.format(new Date(suggestion.lastSeenAt))}
        </span>
      </div>
      <Button
        aria-label={`提案「${suggestion.name}」を語彙に追加`}
        className="min-h-11 shrink-0 md:min-h-8"
        disabled={pending}
        onClick={onPromote}
        variant="outline"
      >
        <Plus data-icon="inline-start" />
        追加
      </Button>
    </li>
  )
}

/**
 * タグ語彙の管理。
 *
 * 画面は「持っている語彙」と「AIが提案してきた名前」の2枚に分ける。この2つは
 * やることが違う（前者は眺めて整理する、後者は1件ずつ採否を決める）ので、
 * 縦に積むと提案を捌いている間ずっと語彙が見えず、採った結果も確認できない。
 * 横に並べれば、採用した名前が左へ移るところがそのまま見える。
 *
 * ここで追加したタグ名だけがAIの候補(enum)になり、ここに無い名前をAIが
 * 出したい場合はtag_suggestionsへ溜まる（表記ゆれが乱立して絞り込み軸として
 * 機能しなくなるのを防ぐ設計。docs/adr参照）。
 */
export function TagVocabularyManagerView({
  tags,
  suggestions,
  isLoading,
  pending,
  createTag,
  deleteTag,
  promoteSuggestion,
}: TagVocabularyManagerViewProps) {
  const [query, setQuery] = useState("")
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null)
  // 絞り込みは一覧そのものを描き直す。打鍵の応答を優先し、後追いさせる。
  const deferredQuery = useDeferredValue(query).trim().toLowerCase()
  const matched =
    deferredQuery === ""
      ? tags
      : tags.filter((tag) => tag.name.toLowerCase().includes(deferredQuery))

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <SettingsSection
        action={
          isLoading ? null : <Badge variant="outline">{tags.length}件</Badge>
        }
        description="AIはここに登録した語彙の中からしかタグを選びません。表記ゆれが乱立して、絞り込みの軸として使えなくなるのを防いでいます。"
        icon={Tags}
        title="タグ語彙"
      >
        <form
          className="flex max-w-md gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            createTag()
          }}
        >
          <AtomInput
            aria-label="新しいタグ名"
            atom={tagNameDraftAtom}
            className="h-11 md:h-9"
            disabled={pending}
            placeholder="新しいタグ名"
          />
          <AddTagButton pending={pending} />
        </form>

        {isLoading ? (
          <div
            aria-label="タグを読み込み中"
            className="flex flex-wrap gap-2"
            role="status"
          >
            {[6, 8, 5, 7, 6, 9].map((width, index) => (
              <Skeleton
                className="h-11 rounded-full md:h-8"
                key={index}
                style={{ width: `${width}rem` }}
              />
            ))}
          </div>
        ) : tags.length > 0 ? (
          <div className="flex flex-col gap-3 border-t pt-5">
            {/*
              少ないうちは目で足りる。絞り込み欄が要るのは、目で追うより
              打つ方が速くなってから。
            */}
            {tags.length > SEARCH_THRESHOLD ? (
              <InputGroup className="h-11 max-w-xs md:h-9">
                <InputGroupAddon>
                  <Search aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="登録済みのタグを絞り込む"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="タグ名で絞り込む"
                  type="search"
                  value={query}
                />
              </InputGroup>
            ) : null}
            {matched.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {matched.map((tag) => (
                  <TagChip
                    key={tag.id}
                    onDelete={() => setPendingDelete(tag)}
                    pending={pending}
                    tag={tag}
                  />
                ))}
              </ul>
            ) : (
              <p className="py-4 text-sm text-muted-foreground" role="status">
                「{query.trim()}」に一致するタグはありません。
              </p>
            )}
          </div>
        ) : (
          <Empty className="border border-dashed py-8">
            <EmptyDescription>
              語彙がまだありません。上のフォームから追加するか、
              「AIからの提案」から採用してください。
            </EmptyDescription>
          </Empty>
        )}
      </SettingsSection>

      <SettingsSection
        action={
          suggestions.length > 0 ? (
            <Badge variant="outline">{suggestions.length}件</Badge>
          ) : null
        }
        description="語彙に無いためタグ付けを見送った名前です。採用すると、以後のAI付与で使われるようになります。"
        icon={Lightbulb}
        title="AIからの提案"
      >
        {suggestions.length > 0 ? (
          <ul className="flex flex-col">
            {suggestions.map((suggestion) => (
              <SuggestionRow
                key={suggestion.name}
                onPromote={() => promoteSuggestion(suggestion.name)}
                pending={pending}
                suggestion={suggestion}
              />
            ))}
          </ul>
        ) : (
          <Empty className="border border-dashed py-8">
            <EmptyDescription>
              提案はありません。記事の処理が進むと、語彙に無い名前がここへ
              溜まります。
            </EmptyDescription>
          </Empty>
        )}
      </SettingsSection>

      {/*
        タグを消すと、記事側の付与も一緒に消える
        (content_article_tagsのFKが ON DELETE CASCADE)。取り消せないので、
        何が起きるかを言ってから消す。
      */}
      <AlertDialog
        onOpenChange={(open) => (!open ? setPendingDelete(null) : undefined)}
        open={pendingDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              「{pendingDelete?.name}」を語彙から削除しますか
            </AlertDialogTitle>
            <AlertDialogDescription>
              このタグが付いている記事からも外れ、絞り込みに使えなくなります。
              以後のAI付与でもこの名前は選ばれません。元に戻すことはできません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDelete(null)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete !== null) deleteTag(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
