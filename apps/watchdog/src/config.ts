import type { CheckTarget } from "./watchdog.js"

type Environment = Readonly<Record<string, string | undefined>>

const configuredUrl = (
  environment: Environment,
  key: string,
  fallback: string
) => environment[key]?.trim() || fallback

export const watchdogTargets = (
  environment: Environment = process.env
): readonly CheckTarget[] => [
  {
    name: "gateway",
    url: configuredUrl(
      environment,
      "WATCHDOG_GATEWAY_URL",
      "http://127.0.0.1:4101/health/ready"
    ),
  },
  {
    name: "identity-access",
    url: configuredUrl(
      environment,
      "WATCHDOG_IDENTITY_ACCESS_URL",
      "http://127.0.0.1:4102/health/ready"
    ),
  },
  {
    name: "content-knowledge",
    url: configuredUrl(
      environment,
      "WATCHDOG_CONTENT_KNOWLEDGE_URL",
      "http://127.0.0.1:4103/health/ready"
    ),
  },
  {
    name: "episode-production",
    url: configuredUrl(
      environment,
      "WATCHDOG_EPISODE_PRODUCTION_URL",
      "http://127.0.0.1:4104/health/ready"
    ),
  },
  {
    name: "episode-library",
    url: configuredUrl(
      environment,
      "WATCHDOG_EPISODE_LIBRARY_URL",
      "http://127.0.0.1:4105/health/ready"
    ),
  },
  {
    name: "voicevox",
    url: configuredUrl(
      environment,
      "WATCHDOG_VOICEVOX_URL",
      "http://127.0.0.1:50021/version"
    ),
  },
  {
    name: "grafana",
    url: configuredUrl(
      environment,
      "WATCHDOG_GRAFANA_URL",
      "http://127.0.0.1:3100/api/health"
    ),
  },
]
