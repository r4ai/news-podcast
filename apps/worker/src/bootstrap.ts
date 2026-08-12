import { getNodeObservability } from "@news-podcast/observability/node/register"

getNodeObservability({
  serviceName: "news-podcast-worker",
  traceSampleRate: 1,
})

await import("./node.js")
