import { getNodeObservability } from "@news-podcast/observability/node/register"

getNodeObservability({ serviceName: "identity-access", traceSampleRate: 1 })

await import("./node.js")
