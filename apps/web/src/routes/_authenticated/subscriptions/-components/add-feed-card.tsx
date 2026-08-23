import { useAtomValue, useSetAtom } from "jotai"
import { Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import type { Feed } from "@/features/subscriptions"
import { canRegisterFeedAtom, feedUrlDraftAtom } from "../-atoms"
import { useFeedCatalog } from "../-hooks/use-feed-catalog"
import { useFeedRegistration } from "../-hooks/use-feed-registration"

type AddFeedMode = "catalog" | "url"

export type CatalogState = {
  readonly candidates: readonly Feed[]
  readonly selectedFeedId: string
  readonly pending: boolean
  readonly canAdd: boolean
  readonly setSelectedFeedId: (value: string) => void
  readonly addSelected: () => void
}

export type RegistrationState = {
  readonly pending: boolean
  readonly submit: () => void
}

/**
 * URLの中身を購読するのはこのボタンだけ。カード全体で購読すると、
 * 打鍵のたびにカタログのコンボボックスまで描き直される。
 */
function RegisterFeedButton({ pending }: { readonly pending: boolean }) {
  const canSubmit = useAtomValue(canRegisterFeedAtom)

  return (
    <Button
      aria-label="URLから追加"
      disabled={!canSubmit || pending}
      size="icon"
      type="submit"
    >
      {pending ? <Spinner /> : <Plus aria-hidden="true" />}
    </Button>
  )
}

/** 入力欄も自分の値だけを購読する。 */
function FeedUrlInput({ disabled }: { readonly disabled: boolean }) {
  const value = useAtomValue(feedUrlDraftAtom)
  const setValue = useSetAtom(feedUrlDraftAtom)

  return (
    <InputGroupInput
      disabled={disabled}
      id="feed-url"
      inputMode="url"
      onChange={(event) => setValue(event.target.value)}
      placeholder="https://example.com/rss"
      required
      type="url"
      value={value}
    />
  )
}

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function AddFeedCard() {
  const catalog = useFeedCatalog()
  const registration = useFeedRegistration()
  return <AddFeedCardView catalog={catalog} registration={registration} />
}

export type AddFeedCardViewProps = {
  readonly catalog: CatalogState
  readonly registration: RegistrationState
}

export function AddFeedCardView({
  catalog,
  registration,
}: AddFeedCardViewProps) {
  const [mode, setMode] = useState<AddFeedMode>("catalog")

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>フィードを追加</h2>
        </CardTitle>
        <CardDescription>
          共有カタログから選ぶか、RSS/AtomのURLを直接指定します。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleGroup
          aria-label="追加方法"
          onValueChange={(value) => {
            const [next] = value
            if (next) setMode(next as AddFeedMode)
          }}
          value={[mode]}
        >
          <ToggleGroupItem value="catalog">カタログから</ToggleGroupItem>
          <ToggleGroupItem value="url">URLで追加</ToggleGroupItem>
        </ToggleGroup>

        {mode === "catalog" ? (
          <div className="flex items-center gap-2">
            <Combobox
              disabled={catalog.pending || catalog.candidates.length === 0}
              onValueChange={(value) => catalog.setSelectedFeedId(value ?? "")}
              value={catalog.selectedFeedId}
            >
              <ComboboxInput className="flex-1" placeholder="フィードを検索" />
              <ComboboxContent>
                <ComboboxEmpty>追加できるフィードはありません。</ComboboxEmpty>
                <ComboboxList>
                  <ComboboxGroup>
                    {catalog.candidates.map((feed) => (
                      <ComboboxItem key={feed.id} value={feed.id}>
                        {feed.name}
                      </ComboboxItem>
                    ))}
                  </ComboboxGroup>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Button
              aria-label="選択したフィードを追加"
              disabled={!catalog.canAdd}
              onClick={catalog.addSelected}
              size="icon"
            >
              {catalog.pending ? <Spinner /> : <Plus aria-hidden="true" />}
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              registration.submit()
            }}
          >
            <Field>
              <FieldLabel htmlFor="feed-url">フィードURL</FieldLabel>
              <div className="flex items-center gap-2">
                <InputGroup className="flex-1">
                  <FeedUrlInput disabled={registration.pending} />
                </InputGroup>
                <RegisterFeedButton pending={registration.pending} />
              </div>
              <FieldDescription>
                HTTP(S)のRSS/Atom
                URLを入力してください。表記は登録時に正規化されます。
              </FieldDescription>
            </Field>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
