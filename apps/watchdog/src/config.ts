import type { CheckTarget } from "./watchdog.js"

type Environment = Readonly<Record<string, string | undefined>>

const configuredUrl = (
  environment: Environment,
  key: string,
  fallback: string
) => environment[key]?.trim() || fallback

export const watchdogTargets = (
  environment: Environment = process.env
): readonly CheckTarget[] => {
  const targets: CheckTarget[] = [
    {
      name: "gateway",
      url: configuredUrl(
        environment,
        "WATCHDOG_GATEWAY_URL",
        "http://gateway:4101/health/ready"
      ),
    },
    {
      name: "identity-access",
      url: configuredUrl(
        environment,
        "WATCHDOG_IDENTITY_ACCESS_URL",
        "http://identity-access:4102/health/ready"
      ),
    },
    {
      name: "content-knowledge",
      url: configuredUrl(
        environment,
        "WATCHDOG_CONTENT_KNOWLEDGE_URL",
        "http://content-knowledge:4103/health/ready"
      ),
    },
    {
      name: "episode-production",
      url: configuredUrl(
        environment,
        "WATCHDOG_EPISODE_PRODUCTION_URL",
        "http://episode-production:4104/health/ready"
      ),
    },
    {
      name: "episode-library",
      url: configuredUrl(
        environment,
        "WATCHDOG_EPISODE_LIBRARY_URL",
        "http://episode-library:4105/health/ready"
      ),
    },
    {
      name: "web",
      url: configuredUrl(environment, "WATCHDOG_WEB_URL", "http://web:4173/"),
    },
    {
      name: "nats-jetstream",
      url: configuredUrl(
        environment,
        "WATCHDOG_NATS_URL",
        "http://nats:8222/healthz?js-enabled-only=true"
      ),
    },
    {
      name: "seaweedfs",
      url: configuredUrl(
        environment,
        "WATCHDOG_SEAWEEDFS_URL",
        "http://seaweedfs:9333/cluster/status"
      ),
    },
    {
      name: "voicevox",
      url: configuredUrl(
        environment,
        "WATCHDOG_VOICEVOX_URL",
        "http://voicevox:50021/version"
      ),
    },
  ]
  const grafanaUrl = environment.WATCHDOG_GRAFANA_URL?.trim()
  if (grafanaUrl) targets.push({ name: "grafana", url: grafanaUrl })
  const collectorUrl = environment.WATCHDOG_COLLECTOR_URL?.trim()
  if (collectorUrl) targets.push({ name: "otel-collector", url: collectorUrl })
  return targets
}
