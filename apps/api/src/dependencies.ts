import type { SqliteAgentRuntimeStore } from "@news-podcast/adapters/agent-runtime/sqlite"
import type { JobDto, LocalStore } from "@news-podcast/adapters/db/local"
import type { Observability, TraceContext } from "@news-podcast/observability"

export type TelemetrySignal = "logs" | "metrics" | "traces"

/**
 * createEpisodeJob の入出力契約。UseCase (CreateEpisodeJob) への配線は
 * composition root（node.ts）が担い、ここでは関数シグネチャのみを持つ。
 */
export type CreateEpisodeJobFn = (input: {
  readonly ownerId: string
  readonly idempotencyKey: string
  readonly articleIds?: readonly string[]
  readonly traceContext?: TraceContext
}) => Promise<JobDto>

/**
 * 大半の /v1 ルートが前提とする中核依存。
 * Cloudflare Workers エントリ（cloudflare.ts）は現状これらを構築しないため
 * undefined になり得る。欠落時の縮退（503）は各ルートの存在チェックに委ねる。
 */
export interface CoreDependencies {
  readonly store?: LocalStore
  readonly agentRuntimeStore?: SqliteAgentRuntimeStore
  readonly resolveOwner?: (request: Request) => Promise<string | null>
}

/** 環境により無効化されうる機能。個別ルートが 503 または機能縮退で対応する。 */
export interface OptionalDependencies {
  readonly authHandler?: (request: Request) => Response | Promise<Response>
  readonly devLoginHandler?: (request: Request) => Promise<Response>
  readonly devLogoutHandler?: (request: Request) => Promise<Response>
  readonly loginMethods?: {
    readonly development: boolean
    readonly google: boolean
  }
  readonly createEpisodeJob?: CreateEpisodeJobFn
  readonly observability?: Observability
  readonly telemetryOrigin?: string
  readonly forwardTelemetry?: (
    signal: TelemetrySignal,
    body: Uint8Array,
    contentType: string
  ) => Promise<void>
  readonly issueAudioAccess?: (
    ownerId: string,
    episodeId: string
  ) => Promise<{ url: string; expiresAt: string } | undefined>
  readonly serveAudio?: (token: string, range?: string) => Promise<Response>
  readonly discoverFeed?: (
    ownerId: string,
    feedUrl: string
  ) => Promise<{
    readonly feed: {
      id: string
      name: string
      siteUrl: string
      feedUrl: string
    }
    readonly subscription: {
      id: string
      feedId: string
      enabled: boolean
      createdAt: string
    }
  }>
  readonly serveArticleMarkdown?: (
    ownerId: string,
    articleId: string
  ) => Promise<Response>
  readonly serveArticleArchive?: (
    ownerId: string,
    articleId: string
  ) => Promise<Response>
  readonly serveArticleAsset?: (
    ownerId: string,
    articleId: string,
    hash: string
  ) => Promise<Response>
  // AI補助（要約+スコア）のオンデマンド再計算。falseはアーカイブ未完了などの対象外。
  readonly enrichArticle?: (
    ownerId: string,
    articleId: string
  ) => Promise<boolean>
  // AI補助バッチの日次上限（キュー状態の表示用）。worker側の実効値と揃える。
  readonly enrichDailyLimit?: number
}

export type AppDependencies = CoreDependencies & OptionalDependencies
