import { useMemo, useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

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

import { api } from "@/api/client"
import { PageHeader } from "@/app/page-header"
import { queryClient } from "@/app/query-client"
import { recordBrowserEvent } from "@/observability/events"

function supportedTimeZones(current: string) {
  const supported = Intl.supportedValuesOf?.("timeZone") ?? []
  return Array.from(
    new Set([current, "Asia/Tokyo", "UTC", ...supported])
  ).sort()
}

export function SchedulePage() {
  const settings = api.useSuspenseQuery("get", "/v1/me/settings")
  const save = api.useMutation("patch", "/v1/me/settings")
  const initial = settings.data.generationSchedule
  const [enabled, setEnabled] = useState(initial.enabled)
  const [localTime, setLocalTime] = useState(initial.localTime)
  const [timeZone, setTimeZone] = useState(initial.timeZone)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()
  const timeZones = useMemo(
    () => supportedTimeZones(initial.timeZone),
    [initial.timeZone]
  )

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(undefined)
    startTransition(async () => {
      try {
        const updated = await save.mutateAsync({
          body: { generationSchedule: { enabled, localTime, timeZone } },
        })
        queryClient.setQueryData(
          api.queryOptions("get", "/v1/me/settings").queryKey,
          updated
        )
        recordBrowserEvent("schedule.changed", { result: "succeeded" })
        toast.success("生成時刻を保存しました")
      } catch {
        recordBrowserEvent("schedule.changed", { result: "failed" })
        setError("時刻とタイムゾーンを確認してください。")
        toast.error("生成時刻を保存できませんでした")
      }
    })
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader
        description="指定したタイムゾーンの時刻に、ニュース番組を自動生成します。"
        title="生成時刻"
      />
      <Card>
        <form onSubmit={submit}>
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
                  checked={enabled}
                  disabled={pending}
                  onCheckedChange={setEnabled}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="generation-time">時刻</FieldLabel>
                <Input
                  disabled={pending || !enabled}
                  id="generation-time"
                  onChange={(event) => setLocalTime(event.target.value)}
                  required
                  type="time"
                  value={localTime}
                />
              </Field>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="generation-time-zone">
                  タイムゾーン
                </FieldLabel>
                <Combobox
                  disabled={pending || !enabled}
                  onValueChange={(value) => setTimeZone(value ?? "")}
                  value={timeZone}
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
                <FieldDescription>
                  IANA形式で選択してください。
                </FieldDescription>
                <FieldError>{error}</FieldError>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button disabled={pending || timeZone.length === 0} type="submit">
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? "保存中…" : "設定を保存"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
