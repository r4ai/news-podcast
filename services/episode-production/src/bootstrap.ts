import { getNodeObservability } from "@news-podcast/observability/node/register"

// Register telemetry before loading NATS, SQLite, or the process composition root.
getNodeObservability({ serviceName: "episode-production", traceSampleRate: 1 })

await import("./node.js")
