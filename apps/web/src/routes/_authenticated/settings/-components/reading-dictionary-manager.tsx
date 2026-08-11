import { Pencil, Plus, X } from "lucide-react"
import { useState } from "react"

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
  readonly surface: string
  readonly reading: string
  readonly pending: boolean
  readonly setSurface: (value: string) => void
  readonly setReading: (value: string) => void
  readonly addEntry: () => void
  readonly updateEntry: (
    id: string,
    patch: { surface?: string; reading?: string; accentType?: number },
  ) => void
  readonly deleteEntry: (id: string) => void
}

export function ReadingDictionaryManagerView({
  entries,
  isLoading,
  surface,
  reading,
  pending,
  setSurface,
  setReading,
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
          <Input
            aria-label="表記（漢字・英字）"
            disabled={pending}
            onChange={(event) => setSurface(event.target.value)}
            placeholder="表記（例: GPT-5）"
            value={surface}
            className="flex-1"
          />
          <Input
            aria-label="読み（カタカナ）"
            disabled={pending}
            onChange={(event) => setReading(event.target.value)}
            placeholder="読み（例: ジーピーティーファイブ）"
            value={reading}
            className="flex-[2]"
          />
          <Button
            disabled={pending || !surface.trim() || !reading.trim()}
            type="submit"
          >
            <Plus data-icon="inline-start" />
            追加
          </Button>
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

function ReadingDictionaryItem({
  entry,
  onDelete,
  onUpdate,
}: {
  entry: ReadingDictionaryEntry
  onDelete: () => void
  onUpdate: (
    id: string,
    patch: { surface?: string; reading?: string; accentType?: number },
  ) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editSurface, setEditSurface] = useState(entry.surface)
  const [editReading, setEditReading] = useState(entry.reading)

  if (editing) {
    return (
      <li className="flex items-center gap-2 rounded-md border px-3 py-2">
        <Input
          aria-label="表記"
          className="flex-1"
          onChange={(event) => setEditSurface(event.target.value)}
          value={editSurface}
        />
        <Input
          aria-label="読み"
          className="flex-[2]"
          onChange={(event) => setEditReading(event.target.value)}
          value={editReading}
        />
        <Button
          disabled={!editSurface.trim() || !editReading.trim()}
          onClick={() => {
            onUpdate(entry.id, {
              surface: editSurface,
              reading: editReading,
            })
            setEditing(false)
          }}
          size="sm"
        >
          保存
        </Button>
        <Button
          onClick={() => {
            setEditSurface(entry.surface)
            setEditReading(entry.reading)
            setEditing(false)
          }}
          size="sm"
          variant="ghost"
        >
          取消
        </Button>
      </li>
    )
  }

  return (
    <li
      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
      key={entry.id}
    >
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
          onClick={() => setEditing(true)}
          size="icon-sm"
          variant="ghost"
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          aria-label={`「${entry.surface}」を削除`}
          onClick={onDelete}
          size="icon-sm"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}
