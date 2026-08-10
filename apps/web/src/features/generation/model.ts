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
  researching_sources: "記事を調査中",
  fetching_sources: "RSSを取得中",
  generating_script: "台本を生成中",
  synthesizing_audio: "音声を生成中",
  storing_episode: "番組を保存中",
} satisfies Record<JobStage, string>

export const statusLabel = (status: JobStatus) => statusLabels[status]
export const stageLabel = (stage: JobStage) => stageLabels[stage]

const failureMessages: Readonly<Record<string, string>> = {
  "provider-timeout":
    "外部サービスが時間内に応答しませんでした。自動再試行または手動再試行を利用できます。",
  "provider-unavailable":
    "外部サービスを一時的に利用できませんでした。時間をおいて再試行してください。",
  "job-deadline-exceeded": "生成時間が30分の安全上限を超えたため停止しました。",
  "attempt-limit-exceeded": "自動試行の上限4回に達したため停止しました。",
  "checkpoint-corruption":
    "保存済みの生成途中データを検証できなかったため、安全に停止しました。",
  "legacy-execution-invalidated":
    "旧方式で実行中だった生成を安全のため停止しました。新しい方式で再試行してください。",
  "pipeline-input-invalid":
    "生成結果を検証できませんでした。内容を変えて再試行してください。",
}

export function failureMessage(failure?: {
  readonly code: string
  readonly message: string
}): string | undefined {
  return failure
    ? (failureMessages[failure.code] ?? failure.message)
    : undefined
}
