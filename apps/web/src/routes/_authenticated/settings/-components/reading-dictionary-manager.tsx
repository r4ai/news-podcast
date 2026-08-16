import { useAtomValue, useSetAtom, useStore } from "jotai"
import { BookA, Check, Pencil, Plus, Search, X } from "lucide-react"
import { useDeferredValue, useState } from "react"

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
import { FieldError } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import { AtomInput } from "@/shared/ui/atom-input"
import {
  canAddReadingAtom,
  forgetReadingEntryEdit,
  readingEntryEditAtom,
  readingProblemAtom,
  readingReadingDraftAtom,
  readingSurfaceDraftAtom,
  readingWillConvertAtom,
} from "../-atoms"
import { useReadingDictionary } from "../-hooks/use-reading-dictionary"
import {
  readingProblem,
  readingProblemMessages,
  selectDictionaryEntries,
  type DictionarySort,
  type DictionarySource,
} from "../-model"
import { SettingsSection } from "./settings-section"

export function ReadingDictionaryManager() {
  const state = useReadingDictionary()
  return <ReadingDictionaryManagerView {...state} />
}

export type ReadingDictionaryEntry = {
  readonly id: string
  readonly surface: string
  readonly reading: string
  readonly accentType: number
  readonly source: "manual" | "ai_auto"
  readonly createdAt: string
}

export type ReadingDictionaryManagerViewProps = {
  readonly entries: readonly ReadingDictionaryEntry[]
  readonly isLoading: boolean
  readonly pending: boolean
  readonly addEntry: () => void
  readonly updateEntry: (
    id: string,
    patch: { surface?: string; reading?: string; accentType?: number }
  ) => void
  readonly deleteEntry: (id: string) => void
}

/**
 * 追加ボタンだけが下書きの中身を購読する。フォーム全体を購読させると、
 * 打鍵のたびに登録済みの一覧まで描き直される。
 */
function AddEntryButton({ pending }: { readonly pending: boolean }) {
  const canAdd = useAtomValue(canAddReadingAtom)

  return (
    <Button className="h-11 sm:h-9" disabled={pending || !canAdd} type="submit">
      <Plus data-icon="inline-start" />
      追加
    </Button>
  )
}

/**
 * 読み欄の判定。
 *
 * 読みは全角カタカナしか通らない。これは見た目の好みではなくContext間契約
 * (`packages/protocols`の`reading`)の制約で、HTTPの入口は長さしか見ないため、
 * ひらがなのまま送ると受理された後にRPC境界で落ちる。以前はそれが
 * 「辞書に追加できませんでした」としか出ず、何が悪いのか分からなかった。
 *
 * 直せるもの（ひらがな・半角カナ）は黙って直さず、「こう登録します」と
 * 見せてから直す。直せないものは理由を出して送らせない。
 */
function ReadingFieldNotice() {
  const problem = useAtomValue(readingProblemAtom)
  const willConvert = useAtomValue(readingWillConvertAtom)

  if (problem !== undefined) {
    return <FieldError>{readingProblemMessages[problem]}</FieldError>
  }
  if (willConvert) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Check aria-hidden="true" className="size-4" />
        カタカナに直して登録します。
      </p>
    )
  }
  return null
}

const sourceFilters: readonly { value: DictionarySource; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "manual", label: "手動" },
  { value: "ai_auto", label: "AI自動" },
]

const sortOptions: readonly { value: DictionarySort; label: string }[] = [
  { value: "recent", label: "新しい順" },
  { value: "surface", label: "表記順" },
]

/**
 * 読み辞書。
 *
 * 登録はエピソードを作るたびAIが自動で足すので、放っておくと増える一方になる。
 * 「探す」「AIが入れたものだけ見直す」が主な仕事になるため、絞り込み・由来・
 * 並び順を一覧の上に常設する。表記も読みも省略しない。
 */
export function ReadingDictionaryManagerView({
  entries,
  isLoading,
  pending,
  addEntry,
  updateEntry,
  deleteEntry,
}: ReadingDictionaryManagerViewProps) {
  const [query, setQuery] = useState("")
  const [source, setSource] = useState<DictionarySource>("all")
  const [sort, setSort] = useState<DictionarySort>("recent")
  const [pendingDelete, setPendingDelete] =
    useState<ReadingDictionaryEntry | null>(null)
  // 絞り込みは一覧そのものを描き直す。打鍵の応答を優先し、後追いさせる。
  const deferredQuery = useDeferredValue(query)
  const matched = selectDictionaryEntries(entries, {
    query: deferredQuery,
    source,
    sort,
  })

  return (
    <SettingsSection
      action={
        isLoading ? null : <Badge variant="outline">{entries.length}件</Badge>
      }
      description="専門用語や固有名詞の読み方を登録します。VOICEVOXの音声合成に自動反映され、エピソード生成時にAIが自動で追加することもあります。"
      icon={BookA}
      title="読み辞書"
    >
      {/*
        3つを1行に詰めると、モバイルでは入力欄が「表記（例」まで縮んで
        何を入れる欄なのか読めなくなっていた。狭い時は縦に積む。
      */}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          addEntry()
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <AtomInput
            aria-label="表記（漢字・英字）"
            atom={readingSurfaceDraftAtom}
            className="h-11 sm:h-9 sm:flex-1"
            disabled={pending}
            placeholder="表記（例: GPT-5）"
          />
          <AtomInput
            aria-label="読み（カタカナ）"
            atom={readingReadingDraftAtom}
            className="h-11 sm:h-9 sm:flex-[2]"
            disabled={pending}
            placeholder="読み（例: ジーピーティーファイブ）"
          />
          <AddEntryButton pending={pending} />
        </div>
        <ReadingFieldNotice />
      </form>

      {isLoading ? (
        <div
          aria-label="読み辞書を読み込み中"
          className="flex flex-col gap-2"
          role="status"
        >
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton className="h-14 rounded-lg sm:h-12" key={index} />
          ))}
        </div>
      ) : entries.length > 0 ? (
        // 追加する場所と、既にあるものを扱う場所を線で分ける。
        <div className="flex flex-col gap-3 border-t pt-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <InputGroup className="h-11 lg:h-9 lg:max-w-xs">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="登録済みの読みを絞り込む"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="表記・読みで絞り込む"
                type="search"
                value={query}
              />
            </InputGroup>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                aria-label="由来で絞り込む"
                onValueChange={(value) => {
                  const [next] = value
                  if (next) setSource(next as DictionarySource)
                }}
                value={[source]}
              >
                {sourceFilters.map((filter) => (
                  <ToggleGroupItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <ToggleGroup
                aria-label="並び順"
                onValueChange={(value) => {
                  const [next] = value
                  if (next) setSort(next as DictionarySort)
                }}
                value={[sort]}
              >
                {sortOptions.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>

          {matched.length > 0 ? (
            <>
              {/*
                広い時だけ出す列見出し。行の中身は`sr-only`の「の読みは」で
                既に読み上げが成立しているので、ここは目のための飾りに徹する。
              */}
              <div
                aria-hidden="true"
                className="hidden grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-3 px-3 text-xs font-medium text-muted-foreground sm:grid"
              >
                <span>表記</span>
                <span className="flex justify-between">
                  <span>読み</span>
                  <span>由来</span>
                </span>
                <span className="w-[5.5rem]" />
              </div>
              <ul className="flex flex-col gap-2">
                {matched.map((entry) => (
                  <ReadingDictionaryItem
                    entry={entry}
                    key={entry.id}
                    onDelete={() => setPendingDelete(entry)}
                    onUpdate={updateEntry}
                  />
                ))}
              </ul>
            </>
          ) : (
            <p className="py-6 text-sm text-muted-foreground" role="status">
              条件に一致する登録はありません。
            </p>
          )}
        </div>
      ) : (
        <Empty className="border border-dashed py-8">
          <EmptyDescription>
            読み辞書がまだありません。「GPT-5」を「ジーピーティーファイブ」と
            読ませたい、のような組を上のフォームから追加してください。
            エピソード生成時にAIが自動で追加することもあります。
          </EmptyDescription>
        </Empty>
      )}

      {/*
        読みを消すと、次の合成からその語は元の読み方に戻る。取り消せないので
        一度確かめる。
      */}
      <AlertDialog
        onOpenChange={(open) => (!open ? setPendingDelete(null) : undefined)}
        open={pendingDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              「{pendingDelete?.surface}」の読みを削除しますか
            </AlertDialogTitle>
            <AlertDialogDescription>
              次の音声合成から「{pendingDelete?.reading}
              」とは読まれなくなります。既に作成済みのエピソードの音声は
              変わりません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDelete(null)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete !== null) deleteEntry(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}

/**
 * 編集中かどうかと編集内容は行ごとに独立している (`atomFamily`)。
 * 1行を編集しても、他の行はその値を購読していないので描き直されない。
 */
function ReadingDictionaryItem({
  entry,
  onDelete,
  onUpdate,
}: {
  entry: ReadingDictionaryEntry
  onDelete: () => void
  onUpdate: (
    id: string,
    patch: { surface?: string; reading?: string; accentType?: number }
  ) => void
}) {
  const editAtom = readingEntryEditAtom(entry.id)
  const edit = useAtomValue(editAtom)
  const setEdit = useSetAtom(editAtom)

  if (edit !== null) {
    // 追加フォームと同じ規則を編集にも当てる。片方だけ緩いと、
    // 直したつもりの行が保存時に落ちる。
    const problem =
      edit.reading.trim() === "" ? "empty" : readingProblem(edit.reading)
    return (
      <li className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label={`「${entry.surface}」の表記`}
            className="h-11 sm:h-9 sm:flex-1"
            onChange={(event) =>
              setEdit({ ...edit, surface: event.target.value })
            }
            value={edit.surface}
          />
          <Input
            aria-invalid={problem !== undefined || undefined}
            aria-label={`「${entry.surface}」の読み`}
            className="h-11 sm:h-9 sm:flex-[2]"
            onChange={(event) =>
              setEdit({ ...edit, reading: event.target.value })
            }
            value={edit.reading}
          />
          <div className="flex gap-2 sm:shrink-0">
            <Button
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              disabled={edit.surface.trim() === "" || problem !== undefined}
              onClick={() => {
                onUpdate(entry.id, {
                  surface: edit.surface,
                  reading: edit.reading,
                })
                setEdit(null)
              }}
            >
              保存
            </Button>
            <Button
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              onClick={() => setEdit(null)}
              variant="ghost"
            >
              取消
            </Button>
          </div>
        </div>
        {problem !== undefined && problem !== "empty" ? (
          <FieldError>{readingProblemMessages[problem]}</FieldError>
        ) : null}
      </li>
    )
  }

  return (
    /*
      狭い時は「表記」と「読み」を2行に積み、操作は右で2行分をまたぐ。
      広い時は表記・読み・操作の3列へ揃え、上の列見出しと合わせて表のように
      読ませる。表記も読みも省略しない (以前は`truncate`で「Durabl…」
      「ngi…」まで潰れていた)。
    */
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:gap-y-0">
      <span className="col-start-1 row-start-1 text-sm font-medium wrap-anywhere">
        {entry.surface}
      </span>
      {/*
        狭い時はバッジを読みの直後に置いて折り返させる。右端へ寄せると
        読みの幅が削られ、カタカナが語の途中で折れる。
      */}
      <span className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground sm:col-start-2 sm:row-start-1 sm:flex-nowrap">
        {/* 「→」は字形であって語ではない。読み上げには言葉の方を渡す。 */}
        <span aria-hidden="true" className="sm:hidden">
          →
        </span>
        <span className="sr-only">の読みは</span>
        <span className="min-w-0 wrap-anywhere">{entry.reading}</span>
        <Badge className="shrink-0 sm:ml-auto" variant="outline">
          {entry.source === "ai_auto" ? "AI自動" : "手動"}
        </Badge>
      </span>
      <div className="col-start-2 row-span-2 row-start-1 flex shrink-0 items-center gap-1 sm:col-start-3 sm:row-span-1">
        <Button
          aria-label={`「${entry.surface}」を編集`}
          className="size-11 sm:size-8"
          onClick={() =>
            setEdit({ surface: entry.surface, reading: entry.reading })
          }
          variant="ghost"
        >
          <Pencil aria-hidden="true" />
        </Button>
        <DeleteEntryButton entry={entry} onDelete={onDelete} />
      </div>
    </li>
  )
}

/** 削除した行の編集下書きは、家族から外して残さない。 */
function DeleteEntryButton({
  entry,
  onDelete,
}: {
  readonly entry: ReadingDictionaryEntry
  readonly onDelete: () => void
}) {
  const store = useStore()

  return (
    <Button
      aria-label={`「${entry.surface}」を削除`}
      className="size-11 hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive sm:size-8"
      onClick={() => {
        store.set(readingEntryEditAtom(entry.id), null)
        forgetReadingEntryEdit(entry.id)
        onDelete()
      }}
      variant="ghost"
    >
      <X aria-hidden="true" />
    </Button>
  )
}
