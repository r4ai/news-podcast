import { useState } from "react"

import { Switch } from "@workspace/ui/components/switch"

import { setTelemetryEnabled, telemetryEnabled } from "./preference"

export function TelemetryPreference() {
  const [enabled] = useState(() => telemetryEnabled())
  const doNotTrack = navigator.doNotTrack === "1"

  function update(next: boolean) {
    setTelemetryEnabled(next)
    window.location.reload()
  }

  return (
    <label className="flex min-h-11 items-center justify-between gap-3 px-2 text-xs text-muted-foreground">
      <span>匿名の品質データを送信</span>
      <Switch
        aria-label="匿名の品質データを送信"
        checked={enabled}
        disabled={doNotTrack}
        onCheckedChange={update}
      />
    </label>
  )
}
