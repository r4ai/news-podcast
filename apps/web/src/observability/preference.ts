const preferenceKey = "news-podcast:telemetry:v1"

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">

export function telemetryEnabled(
  storage: PreferenceStorage = localStorage,
  doNotTrack: string | null = navigator.doNotTrack
): boolean {
  if (doNotTrack === "1") return false
  return storage.getItem(preferenceKey) !== "disabled"
}

export function setTelemetryEnabled(
  enabled: boolean,
  storage: PreferenceStorage = localStorage
): void {
  storage.setItem(preferenceKey, enabled ? "enabled" : "disabled")
}
