import type { components } from "@news-podcast/contracts/openapi"

type JobStatus = components["schemas"]["JobStatus"]
type JobStage = components["schemas"]["JobStage"]

const statusLabels = {
  queued: "待機中",
  running: "生成中",
  retrying: "再試行待ち",
  succeeded: "完成",
  failed: "失敗",
  canceled: "キャンセル",
} satisfies Record<JobStatus, string>

const stageLabels = {
  fetching_sources: "RSSを取得中",
  generating_script: "台本を生成中",
  synthesizing_audio: "音声を生成中",
  storing_episode: "番組を保存中",
} satisfies Record<JobStage, string>

export const statusLabel = (status: JobStatus) => statusLabels[status]
export const stageLabel = (stage: JobStage) => stageLabels[stage]
