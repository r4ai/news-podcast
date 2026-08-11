// エピソード生成の非同期ジョブ（作成・進捗取得・キャンセル・再試行・SSE配信）。
import type { RouteRegistrar } from "../../http/context.js"
import { registerCancelJob } from "./cancel.js"
import { registerCreateJob } from "./create.js"
import { registerJobEvents } from "./events.js"
import { registerGetJob } from "./get.js"
import { registerListJobs } from "./list.js"
import { registerRetryJob } from "./retry.js"

export const episodeJobsRegistrars: readonly RouteRegistrar[] = [
  registerListJobs,
  registerCreateJob,
  registerGetJob,
  registerCancelJob,
  registerRetryJob,
  registerJobEvents,
]
