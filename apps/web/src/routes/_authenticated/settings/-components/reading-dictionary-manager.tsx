import { useAtomValue, useSetAtom, useStore } from "jotai"
import { Pencil, Plus, X } from "lucide-react"

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

import { AtomInput } from "@/shared/ui/atom-input"
import {
  canAddReadingAtom,
  forgetReadingEntryEdit,
  readingEntryEditAtom,
  readingReadingDraftAtom,
  readingSurfaceDraftAtom,
} from "../-atoms"
import { useReadingDictionary } from "../-hooks/use-reading-dictionary"

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
    <Button disabled={pending || !canAdd} type="submit">
      <Plus data-icon="inline-start" />
      追加
    </Button>
  )
}

export function ReadingDictionaryManagerView({
  entries,
  isLoading,
  pending,
  addEntry,
  updateEntry,
  deleteEntry,
}: ReadingDictionaryManagerViewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>読み辞書</h2>
        </CardTitle>
        <CardDescription>
          専門用語や固有名詞の読み方を登録します。VOICEVOXの音声合成に自動反映されます。
          AIが自動で追加することもあります。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            addEntry()
          }}
        >
          <AtomInput
            aria-label="表記（漢字・英字）"
            atom={readingSurfaceDraftAtom}
            className="flex-1"
            disabled={pending}
            placeholder="表記（例: GPT-5）"
          />
          <AtomInput
            aria-label="読み（カタカナ）"
            atom={readingReadingDraftAtom}
            className="flex-[2]"
            disabled={pending}
            placeholder="読み（例: ジーピーティーファイブ）"
          />
          <AddEntryButton pending={pending} />
        </form>

        {isLoading ? null : entries.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <ReadingDictionaryItem
                entry={entry}
                key={entry.id}
                onDelete={() => deleteEntry(entry.id)}
                onUpdate={updateEntry}
              />
            ))}
          </ul>
        ) : (
          <Empty className="border border-dashed py-6">
            <EmptyDescription>
              読み辞書がまだありません。上のフォームから追加するか、
              エピソード生成時にAIが自動で追加します。
            </EmptyDescription>
          </Empty>
        )}
      </CardContent>
    </Card>
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
    return (
      <li className="flex items-center gap-2 rounded-md border px-3 py-2">
        <Input
          aria-label="表記"
          className="flex-1"
          onChange={(event) =>
            setEdit({ ...edit, surface: event.target.value })
          }
          value={edit.surface}
        />
        <Input
          aria-label="読み"
          className="flex-[2]"
          onChange={(event) =>
            setEdit({ ...edit, reading: event.target.value })
          }
          value={edit.reading}
        />
        <Button
          disabled={!edit.surface.trim() || !edit.reading.trim()}
          onClick={() => {
            onUpdate(entry.id, {
              surface: edit.surface,
              reading: edit.reading,
            })
            setEdit(null)
          }}
          size="sm"
        >
          保存
        </Button>
        <Button onClick={() => setEdit(null)} size="sm" variant="ghost">
          取消
        </Button>
      </li>
    )
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{entry.surface}</span>
        <span className="text-xs text-muted-foreground">→</span>
        <span className="text-sm text-muted-foreground truncate">
          {entry.reading}
        </span>
        <Badge variant="outline" className="text-xs shrink-0">
          {entry.source === "ai_auto" ? "AI自動" : "手動"}
        </Badge>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          aria-label={`「${entry.surface}」を編集`}
          onClick={() =>
            setEdit({ surface: entry.surface, reading: entry.reading })
          }
          size="icon-sm"
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
      onClick={() => {
        store.set(readingEntryEditAtom(entry.id), null)
        forgetReadingEntryEdit(entry.id)
        onDelete()
      }}
      size="icon-sm"
      variant="ghost"
    >
      <X aria-hidden="true" />
    </Button>
  )
}
