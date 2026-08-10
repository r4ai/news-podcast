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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"

import { useScheduleForm } from "../-hooks/use-schedule-form"
import type { ScheduleDraft } from "../-model"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function ScheduleForm() {
  const form = useScheduleForm()
  return <ScheduleFormView {...form} />
}

export type ScheduleFormViewProps = {
  readonly draft: ScheduleDraft
  readonly error?: string
  readonly pending: boolean
  readonly canSubmit: boolean
  readonly timeZones: readonly string[]
  readonly update: (patch: Partial<ScheduleDraft>) => void
  readonly submit: () => void
}

export function ScheduleFormView({
  canSubmit,
  draft,
  error,
  pending,
  timeZones,
  submit,
  update,
}: ScheduleFormViewProps) {
  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <CardHeader>
          <CardTitle>
            <h2>自動生成</h2>
          </CardTitle>
          <CardDescription>
            Worker再起動時も、当日未生成であれば一度だけ補完します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>毎日自動生成する</FieldTitle>
                <FieldDescription>
                  無効にしても手動生成は引き続き利用できます。
                </FieldDescription>
              </FieldContent>
              <Switch
                aria-label="毎日自動生成する"
                checked={draft.enabled}
                disabled={pending}
                onCheckedChange={(enabled) => update({ enabled })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="generation-time">時刻</FieldLabel>
              <Input
                disabled={pending || !draft.enabled}
                id="generation-time"
                onChange={(event) => update({ localTime: event.target.value })}
                required
                type="time"
                value={draft.localTime}
              />
            </Field>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="generation-time-zone">
                タイムゾーン
              </FieldLabel>
              <Combobox
                disabled={pending || !draft.enabled}
                onValueChange={(value) => update({ timeZone: value ?? "" })}
                value={draft.timeZone}
              >
                <ComboboxInput
                  aria-invalid={Boolean(error)}
                  id="generation-time-zone"
                  placeholder="タイムゾーンを検索"
                />
                <ComboboxContent>
                  <ComboboxEmpty>
                    一致するタイムゾーンがありません。
                  </ComboboxEmpty>
                  <ComboboxList>
                    <ComboboxGroup>
                      {timeZones.map((zone) => (
                        <ComboboxItem key={zone} value={zone}>
                          {zone}
                        </ComboboxItem>
                      ))}
                    </ComboboxGroup>
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <FieldDescription>IANA形式で選択してください。</FieldDescription>
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button disabled={!canSubmit} type="submit">
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "保存中…" : "設定を保存"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
