import { Check, Clock, TriangleAlert } from "lucide-react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
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
import { Input } from "@workspace/ui/components/input"
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
  // Comboboxの選択値は候補と同じオブジェクトで持つ。文字列を渡すと候補と
  // 照合できず、入力欄に選択中のラベルが出ない。
  const selectedZone =
    timeZones.find((zone) => zone.value === draft.timeZone) ?? null
  // 自動生成がoffなら、時刻もタイムゾーンも効果を持たない。両方まとめて閉じる。
  const locked = !draft.enabled

  return (
    // formはCardの外側。内側に挟むとCard自身のflex gapが1要素にしか効かず、
    // headerとcontentが密着する。
    // Enterでの確定はAction経由。preventDefaultも送信ボタンも要らない。
    <form action={() => saveNow()}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <h2>自動生成</h2>
          </CardTitle>
          <CardDescription>
            Worker再起動時も、当日未生成であれば一度だけ補完します。
          </CardDescription>
          <CardAction>
            <SaveIndicator state={saveState} />
          </CardAction>
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

            <Field data-disabled={locked}>
              <FieldLabel htmlFor="generation-time">時刻</FieldLabel>
              <Input
                disabled={locked}
                id="generation-time"
                onChange={(event) => update({ localTime: event.target.value })}
                required
                type="time"
                value={draft.localTime}
              />
              <FieldDescription>
                下のタイムゾーンでの時刻として扱います。
              </FieldDescription>
            </Field>

            <Field data-disabled={locked} data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="generation-time-zone">
                タイムゾーン
              </FieldLabel>
              {/*
                `items`を渡して初めてBase UIが入力に応じた絞り込みをする。
                渡さないと候補が常に空扱いになり、検索も効かず空メッセージが出続ける。
              */}
              <Combobox
                disabled={locked}
                isItemEqualToValue={(item, value) => item.value === value.value}
                items={timeZones}
                onValueChange={(zone) =>
                  update({ timeZone: zone?.value ?? "" })
                }
                value={selectedZone}
              >
                <ComboboxInput
                  aria-invalid={Boolean(error)}
                  disabled={locked}
                  id="generation-time-zone"
                  // 入力欄には選択中のゾーンが入っている。全選択しておかないと
                  // 打った文字がその後ろに足され、何も一致しなくなる。
                  onFocus={(event) => event.currentTarget.select()}
                  placeholder="地域名や都市名で検索"
                />
                <ComboboxContent>
                  <ComboboxEmpty>
                    一致するタイムゾーンがありません。
                  </ComboboxEmpty>
                  <ComboboxList>
                    <ComboboxCollection>
                      {(zone: TimeZoneOption) => (
                        <ComboboxItem key={zone.value} value={zone}>
                          {zone.label}
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </form>
  )
}

/**
 * 自動保存の進行を1つのlive regionで伝える。要素を出し入れせず中身だけ
 * 差し替えるので、読み上げが「消えた/現れた」ではなく状態の変化として届く。
 *
 * 幅も先に確保しておく。文言ごとに幅が変わると、入力のたびにheaderが
 * 動いてちらついて見える。
 */
function SaveIndicator({ state }: { readonly state: SaveState }) {
  return (
    <span
      aria-label="保存状態"
      aria-live="polite"
      className={cn(
        "flex h-5 min-w-28 items-center justify-end gap-1.5 text-sm",
        state === "error" ? "text-destructive" : "text-muted-foreground"
      )}
      role="status"
    >
      {state === "saving" && (
        <>
          <Spinner className="size-3.5" />
          保存中…
        </>
      )}
      {state === "saved" && (
        <>
          <Check aria-hidden="true" className="size-3.5 text-primary" />
          保存済み
        </>
      )}
      {state === "error" && (
        <>
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          保存できませんでした
        </>
      )}
    </span>
  )
}
