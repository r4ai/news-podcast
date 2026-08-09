import { createApp } from "./app.js"

interface CloudflareBindings {
  readonly DB: D1Database
  readonly AUDIO: R2Bucket
  readonly EPISODE_JOBS: Queue
}

// Better Auth D1 wiring is intentionally deferred until its generated schema is
// checked into the first authenticated vertical slice. No protected route is enabled.
export default createApp()
  .fetch as ExportedHandlerFetchHandler<CloudflareBindings>
