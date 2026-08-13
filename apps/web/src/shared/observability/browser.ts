import { telemetryEnabled } from "./preference"
import { start } from "./otel"

export function startBrowserObservability(): void {
  if (
    import.meta.env.VITE_TELEMETRY_ENABLED === "false" ||
    !telemetryEnabled()
  ) {
    return
  }
  start()
}
