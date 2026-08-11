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
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"

import { useInterestProfileForm } from "../-hooks/use-interest-profile-form"
import type { InterestProfileDraft } from "../-model"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function InterestProfileForm() {
  const form = useInterestProfileForm()
  return <InterestProfileFormView {...form} />
}

export type InterestProfileFormViewProps = {
  readonly draft: InterestProfileDraft
  readonly pending: boolean
  readonly confirmOpen: boolean
  readonly canSubmit: boolean
  readonly update: (patch: Partial<InterestProfileDraft>) => void
  readonly requestSave: () => void
  readonly cancelSave: () => void
  readonly confirmSave: () => void
}

export function InterestProfileFormView({
  draft,
  pending,
  confirmOpen,
  canSubmit,
  update,
  requestSave,
  cancelSave,
  confirmSave,
}: InterestProfileFormViewProps) {
  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          requestSave()
        }}
      >
        <CardHeader>
          <CardTitle>
            <h2>興味プロフィール</h2>
          </CardTitle>
          <CardDescription>
            AIが記事の適合度スコアと要約タグを付けるときに参照します。自由記述で構いません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="interest-include">含めたい話題</FieldLabel>
              <Textarea
                disabled={pending}
                id="interest-include"
                onChange={(event) => update({ include: event.target.value })}
                placeholder="例: 生成AI、フロントエンドの新技術、宇宙開発"
                rows={4}
                value={draft.include}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="interest-exclude">除きたい話題</FieldLabel>
              <Textarea
                disabled={pending}
                id="interest-exclude"
                onChange={(event) => update({ exclude: event.target.value })}
                placeholder="例: 芸能ゴシップ、スポーツの試合速報"
                rows={4}
                value={draft.exclude}
              />
              <FieldDescription>
                除きたい話題に近い記事は、適合度スコアが低く付きます。
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button disabled={!canSubmit} type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "保存中…" : "保存"}
          </Button>
        </CardFooter>
      </form>

      <AlertDialog
        onOpenChange={(open) => (!open ? cancelSave() : undefined)}
        open={confirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>保存しますか</AlertDialogTitle>
            <AlertDialogDescription>
              興味プロフィールを変更しても、既に処理済みの記事は自動では
              再計算されません。最新のスコアとタグで再計算する場合は、
              下の「AI処理」から「全記事を再処理」を明示的に実行してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelSave}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>
              保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
