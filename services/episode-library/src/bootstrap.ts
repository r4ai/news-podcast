import { getNodeObservability } from "@news-podcast/observability/node/register"

// Register telemetry before loading AWS, NATS, SQLite, or the composition root.
getNodeObservability({ serviceName: "episode-library", traceSampleRate: 1 })

await import("./node.js")
