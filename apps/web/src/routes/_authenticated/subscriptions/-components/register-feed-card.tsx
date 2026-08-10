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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"

import { useFeedRegistration } from "../-hooks/use-feed-registration"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function RegisterFeedCard() {
  const registration = useFeedRegistration()
  return <RegisterFeedCardView {...registration} />
}

export type RegisterFeedCardViewProps = {
  readonly feedUrl: string
  readonly pending: boolean
  readonly canSubmit: boolean
  readonly setFeedUrl: (value: string) => void
  readonly submit: () => void
}

export function RegisterFeedCardView({
  canSubmit,
  feedUrl,
  pending,
  setFeedUrl,
  submit,
}: RegisterFeedCardViewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>RSS URLから追加</h2>
        </CardTitle>
        <CardDescription>
          RSSまたはAtomのURLを確認し、そのまま購読へ追加します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="feed-url">フィードURL</FieldLabel>
            <Input
              id="feed-url"
              inputMode="url"
              onChange={(event) => setFeedUrl(event.target.value)}
              placeholder="https://example.com/feed.xml"
              type="url"
              value={feedUrl}
            />
            <FieldDescription>
              登録後、新着記事は自動的にオフライン保存されます。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end">
        <Button disabled={!canSubmit} onClick={submit}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          URLから追加
        </Button>
      </CardFooter>
    </Card>
  )
}
