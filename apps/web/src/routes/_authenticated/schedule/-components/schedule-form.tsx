import { Check, Clock, TriangleAlert } from "lucide-react"

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
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import { useScheduleForm, type SaveState } from "../-hooks/use-schedule-form"
import type { ScheduleDraft, TimeZoneOption } from "../-model"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function ScheduleForm() {
  const form = useScheduleForm()
  return <ScheduleFormView {...form} />
}

export type ScheduleFormViewProps = {
  readonly draft: ScheduleDraft
  readonly error?: string
  readonly saveState: SaveState
  readonly timeZones: readonly TimeZoneOption[]
  readonly update: (patch: Partial<ScheduleDraft>) => void
  readonly saveNow: (patch?: Partial<ScheduleDraft>) => void
}

export function ScheduleFormView({
  draft,
  error,
  saveState,
  timeZones,
  update,
  saveNow,
}: ScheduleFormViewProps) {
  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          saveNow()
        }}
      >
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clock aria-hidden="true" className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <CardTitle>
                <h2>自動生成</h2>
              </CardTitle>
              <CardDescription>
                Worker再起動時も、当日未生成であれば一度だけ補完します。
              </CardDescription>
            </div>
          </div>
          <div className="shrink-0 pt-0.5">
            <SaveIndicator state={saveState} />
          </div>
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
                onCheckedChange={(enabled) => saveNow({ enabled })}
              />
            </Field>

            <FieldSeparator />

            <Field>
              <FieldLabel htmlFor="generation-time">時刻</FieldLabel>
              <InputGroup className={cn(!draft.enabled && "opacity-50")}>
                <InputGroupAddon>
                  <Clock aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  className="h-11 text-2xl font-medium tabular-nums"
                  disabled={!draft.enabled}
                  id="generation-time"
                  onChange={(event) =>
                    update({ localTime: event.target.value })
                  }
                  required
                  type="time"
                  value={draft.localTime}
                />
              </InputGroup>
            </Field>

            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="generation-time-zone">
                タイムゾーン
              </FieldLabel>
              <Combobox
                disabled={!draft.enabled}
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
                        <ComboboxItem key={zone.value} value={zone.value}>
                          {zone.label}
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
      </form>
    </Card>
  )
}

function SaveIndicator({ state }: { readonly state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        保存中…
      </span>
    )
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Check aria-hidden="true" className="size-3.5 text-primary" />
        保存済み
      </span>
    )
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive">
        <TriangleAlert aria-hidden="true" className="size-3.5" />
        保存できませんでした
      </span>
    )
  }
  return null
}
