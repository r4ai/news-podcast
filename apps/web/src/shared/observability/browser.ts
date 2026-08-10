import { telemetryEnabled } from "./preference"

export function startBrowserObservability(): void {
  if (
    import.meta.env.VITE_TELEMETRY_ENABLED === "false" ||
    !telemetryEnabled()
  ) {
    return
  }
  const start = () => void import("./otel").then(({ start }) => start())
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 2_000 })
  } else {
    setTimeout(start, 0)
  }
}
