import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Spinner } from "@workspace/ui/components/spinner"

import type { Feed } from "@/features/subscriptions"
import { useFeedCatalog } from "../-hooks/use-feed-catalog"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function FeedCatalogCard() {
  const catalog = useFeedCatalog()
  return <FeedCatalogCardView {...catalog} />
}

export type FeedCatalogCardViewProps = {
  readonly candidates: readonly Feed[]
  readonly selectedFeedId: string
  readonly pending: boolean
  readonly canAdd: boolean
  readonly setSelectedFeedId: (value: string) => void
  readonly addSelected: () => void
}

export function FeedCatalogCardView({
  addSelected,
  canAdd,
  candidates,
  pending,
  selectedFeedId,
  setSelectedFeedId,
}: FeedCatalogCardViewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>カタログから追加</h2>
        </CardTitle>
        <CardDescription>名前で検索して購読へ追加できます。</CardDescription>
      </CardHeader>
      <CardContent>
        <Combobox
          disabled={pending || candidates.length === 0}
          onValueChange={(value) => setSelectedFeedId(value ?? "")}
          value={selectedFeedId}
        >
          <ComboboxInput placeholder="フィードを検索" />
          <ComboboxContent>
            <ComboboxEmpty>追加できるフィードはありません。</ComboboxEmpty>
            <ComboboxList>
              <ComboboxGroup>
                {candidates.map((feed) => (
                  <ComboboxItem key={feed.id} value={feed.id}>
                    {feed.name}
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </CardContent>
      <CardFooter className="justify-end">
        <Button disabled={!canAdd} onClick={addSelected}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          追加する
        </Button>
      </CardFooter>
    </Card>
  )
}
