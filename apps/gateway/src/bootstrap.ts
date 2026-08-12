import { getNodeObservability } from "@news-podcast/observability/node/register"

// Register automatic HTTP/fetch instrumentation before the composition root
// imports Node networking modules.
getNodeObservability({ serviceName: "gateway", traceSampleRate: 1 })

await import("./node.js")
