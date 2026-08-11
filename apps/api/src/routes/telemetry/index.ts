import type { RouteRegistrar } from "../../http/context.js"
import { registerIngestTelemetry } from "./ingest.js"

export const telemetryRegistrars: readonly RouteRegistrar[] = [
  registerIngestTelemetry,
]
