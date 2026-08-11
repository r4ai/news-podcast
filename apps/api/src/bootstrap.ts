import { getNodeObservability } from "@news-podcast/observability/node/register"

// Static ESM imports are evaluated before this module body. Start the SDK here,
// then load the API composition root so instrumentation-http can patch node:http
// before @hono/node-server captures it.
getNodeObservability({ serviceName: "news-podcast-api" })

await import("./node.js")
