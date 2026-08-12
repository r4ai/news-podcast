import { getNodeObservability } from "@news-podcast/observability/node/register"

// Register telemetry before loading NATS, SQLite, or the composition root.
getNodeObservability({ serviceName: "content-knowledge", traceSampleRate: 1 })

await import("./node.js")
