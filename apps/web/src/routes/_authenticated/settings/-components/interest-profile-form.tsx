import { Sparkles } from "lucide-react"

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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { useInterestProfileForm } from "../-hooks/use-interest-profile-form"
import {
  INTEREST_PROFILE_MAX_LENGTH,
  type InterestProfileDraft,
} from "../-model"
import { SettingsSection } from "./settings-section"

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
  readonly dirty: boolean
  readonly update: (patch: Partial<InterestProfileDraft>) => void
  readonly discard: () => void
  readonly requestSave: () => void
  readonly cancelSave: () => void
  readonly confirmSave: () => void
}

const counter = new Intl.NumberFormat("ja-JP")

/**
 * 上限を超えたことを、無効になった保存ボタンではなく入力欄の側で伝える。
 * 以前は2,000字を超えると保存ボタンが黙って無効になるだけで、どちらの欄が
 * 何字超えているのかが画面のどこにも出ていなかった。
 */
function ProfileField({
  description,
  disabled,
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly placeholder: string
  readonly description: string
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  const over = value.length > INTEREST_PROFILE_MAX_LENGTH
  const countId = `${id}-count`
  const errorId = `${id}-error`

  return (
    <Field data-invalid={over || undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span
          className={cn(
            "text-xs tabular-nums text-muted-foreground",
            over && "font-medium text-destructive"
          )}
          id={countId}
        >
          {counter.format(value.length)} /{" "}
          {counter.format(INTEREST_PROFILE_MAX_LENGTH)}
        </span>
      </div>
      <Textarea
        aria-describedby={over ? `${countId} ${errorId}` : countId}
        aria-invalid={over || undefined}
        className="min-h-28 resize-y"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={5}
        value={value}
      />
      {over ? (
        <FieldError id={errorId}>
          {counter.format(value.length - INTEREST_PROFILE_MAX_LENGTH)}
          字を減らしてください。
        </FieldError>
      ) : (
        <FieldDescription>{description}</FieldDescription>
      )}
    </Field>
  )
}

export function InterestProfileFormView({
  draft,
  pending,
  confirmOpen,
  canSubmit,
  dirty,
  update,
  discard,
  requestSave,
  cancelSave,
  confirmSave,
}: InterestProfileFormViewProps) {
  return (
    // formはCardの外側。内側へ挟むとCard自身のflex gapが子1つにしか掛からず、
    // headerとcontentが隙間なく密着する (schedule-formと同じ理由)。
    <form
      onSubmit={(event) => {
        event.preventDefault()
        requestSave()
      }}
    >
      <SettingsSection
        description="AIが記事の適合度スコアと要約タグを付けるときに参照します。箇条書きでも文章でも構いません。"
        action={dirty ? <Badge variant="secondary">未保存の変更</Badge> : null}
        footer={
          <>
            {/*
              変更を捨てる出口を置く。以前は保存する以外に元へ戻す方法が無く、
              書きかけを消すには保存済みの内容を思い出して打ち直すしかなかった。
            */}
            <Button
              className="mr-auto"
              disabled={!dirty || pending}
              onClick={discard}
              type="button"
              variant="ghost"
            >
              変更を破棄
            </Button>
            <Button disabled={!canSubmit} type="submit">
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? "保存中…" : "保存"}
            </Button>
          </>
        }
        icon={Sparkles}
        title="興味プロフィール"
      >
        {/*
          幅はviewportではなくカード自身で決める。この区画は画面幅次第で
          1列にも2列にもなるので、`md:`のようなviewport基準だと2列レイアウトの
          細いカードの中で横に潰れる。
        */}
        <div className="@container">
          <div className="grid gap-5 @xl:grid-cols-2">
            <ProfileField
              description="ここに近い話題ほど適合度スコアが高く付きます。"
              disabled={pending}
              id="interest-include"
              label="含めたい話題"
              onChange={(include) => update({ include })}
              placeholder="例: 生成AI、フロントエンドの新技術、宇宙開発"
              value={draft.include}
            />
            <ProfileField
              description="ここに近い話題は、適合度スコアが低く付きます。"
              disabled={pending}
              id="interest-exclude"
              label="除きたい話題"
              onChange={(exclude) => update({ exclude })}
              placeholder="例: 芸能ゴシップ、スポーツの試合速報"
              value={draft.exclude}
            />
          </div>
        </div>
      </SettingsSection>

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
              「AI処理」の「全記事を再処理」を明示的に実行してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelSave}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>保存</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
