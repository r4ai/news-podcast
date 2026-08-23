import type { Observability } from "./contract.js"

type ProviderConfigurationTelemetry = Pick<Observability, "gauge" | "log">

export const recordProviderConfiguration = (
  observability: ProviderConfigurationTelemetry,
  configuration: Readonly<{
    appEnvironment: "development" | "test" | "production"
    providerMode: "fake" | "live"
  }>
): void => {
  const attributes = {
    "app.env": configuration.appEnvironment,
    "deployment.environment": configuration.appEnvironment,
    "provider.mode": configuration.providerMode,
  } as const
  observability.log({
    name: "provider.configuration",
    attributes,
  })
  observability.gauge("provider.configuration", 1, attributes)
}
