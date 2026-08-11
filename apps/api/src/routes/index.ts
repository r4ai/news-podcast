// 全ルートの登録順を決める唯一の場所。
//
// 順序はOpenAPI文書の paths キー順に反映されるため（ADR-0008: Honoのroute定義が
// 契約の正本）、リソースをディレクトリで分けた後も既存の openapi.json と
// 一致させる必要がある。Articles と AI enrichment(enrich-queue) は元々
// 交互に登録されていたため、articles/ からは個々のregistrarを直接importして
// この順序どおりに並べている。
import type { ApiApp, RouteRegistrar } from "../http/context.js"
import type { AppDependencies } from "../dependencies.js"
import { authRegistrars } from "./auth/index.js"
import { telemetryRegistrars } from "./telemetry/index.js"
import { registerHealth } from "./health.js"
import { feedsRegistrars } from "./feeds/index.js"
import {
  registerListArticles,
  registerArticleFacets,
  registerGetArticle,
  registerPatchArticle,
  registerBulkArticleState,
  registerArticleMarkdown,
  registerArticleArchive,
  registerEnrichArticle,
  registerArticleAsset,
  registerPutArticleTags,
} from "./articles/index.js"
import { enrichQueueRegistrars } from "./enrich-queue/index.js"
import { tagsRegistrars } from "./tags/index.js"
import { readingDictionaryRegistrars } from "./reading-dictionary/index.js"
import { subscriptionsRegistrars } from "./subscriptions/index.js"
import { settingsRegistrars } from "./settings/index.js"
import { episodeJobsRegistrars } from "./episode-jobs/index.js"
import { agentRunsRegistrars } from "./agent-runs/index.js"
import { agentInstancesRegistrars } from "./agent-instances/index.js"
import { episodesRegistrars } from "./episodes/index.js"
import { audioRegistrars } from "./audio/index.js"

// 開発ログイン/ログアウト・認証状態・Better Auth委譲。/v1系ミドルウェアの対象外。
// app.ts は /v1/* ミドルウェアより前にこれを登録する。
export const unversionedRegistrars: readonly RouteRegistrar[] = authRegistrars

// /v1/* の実ルート。この配列の並びが契約(openapi.jsonのpaths順)になる。
// app.ts は /v1/* ミドルウェアより後にこれを登録する。
export const v1Registrars: readonly RouteRegistrar[] = [
  ...telemetryRegistrars,
  registerHealth,
  ...feedsRegistrars,
  registerListArticles,
  registerArticleFacets,
  registerGetArticle,
  registerPatchArticle,
  registerBulkArticleState,
  registerArticleMarkdown,
  registerArticleArchive,
  registerEnrichArticle,
  ...enrichQueueRegistrars,
  registerArticleAsset,
  registerPutArticleTags,
  ...tagsRegistrars,
  ...readingDictionaryRegistrars,
  ...subscriptionsRegistrars,
  ...settingsRegistrars,
  ...episodeJobsRegistrars,
  ...agentRunsRegistrars,
  ...agentInstancesRegistrars,
  ...episodesRegistrars,
  ...audioRegistrars,
]

function runRegistrars(
  registrars: readonly RouteRegistrar[],
  app: ApiApp,
  dependencies: AppDependencies
): void {
  for (const register of registrars) register(app, dependencies)
}

/** 開発ログイン等の非バージョン管理ルートを登録する。/v1ミドルウェアより前に呼ぶ。 */
export function registerUnversionedRoutes(
  app: ApiApp,
  dependencies: AppDependencies
): void {
  runRegistrars(unversionedRegistrars, app, dependencies)
}

/** /v1/* の全ルートを契約順で登録する。/v1ミドルウェアより後に呼ぶ。 */
export function registerV1Routes(
  app: ApiApp,
  dependencies: AppDependencies
): void {
  runRegistrars(v1Registrars, app, dependencies)
}
