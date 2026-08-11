# ADR-0024: AI補助の優先度付き処理キューと明示再処理

- Status: Accepted
- Date: 2026-08-11
- Decision owners: Platform
- Supersedes: ADR-0021の「プロフィール変更時の再計算方針」（§決定-プロフィール変更時の再計算方針）
- Superseded by: N/A
- Related: ADR-0021（AI補助バッチの基盤）、ADR-0016（リース機構パターン）、ADR-0008（コードファーストOpenAPI）

## コンテキストと変更契機

ADR-0021では「興味プロフィール変更→`profile_hash`不一致→全記事が自動で再処理対象」と決めていた。
運用で「AI処理待ちN件」が常に高止まりする原因の一つになり、ユーザーから以下の要望が出た。

1. **プロフィール編集・タグ語彙追加では、処理済み記事を自動で再処理しない**。再処理は設定・記事詳細からの明示操作のみ。
2. **「AI処理待ちN件」バッジをクリックすると、処理中/待ち/失敗/日次上限がひと目で分かる**（SSEでリアルタイム）。
3. **優先度付きキュー**。新着・未処理記事を優先し、明示再処理は後回しにする。

また、従来の候補選定（`NOT EXISTS`の都度SQL）は「処理中」状態を持たず、複数worker/APIのオンデマンドと
並走した場合に同じ記事へAIコールが二重に飛ぶレースがあった。キュー導入でこれも解消する。

## 決定

### 「1回処理済み」の定義を profile_hash 非依存へ

`article_relevance` で**任意の `profile_hash`** の `status='succeeded'` 行があれば「処理済み」とする。
プロフィール編集・タグ追加では自動再処理しない。表示（`attachAiEnrichment`/`sort=relevance`）は
`profile_hash`/`prompt_version` を問わず最新の `succeeded` スコアを反映し、再処理されるまで古いスコアを出し続ける。

### `enrich_queue` テーブル（migration `0014_enrich_queue.sql`）

| 列 | 意味 |
| --- | --- |
| `owner_id`, `feed_item_id` | 複合PK（owner×記事） |
| `priority` | 0=新着・未処理（自動）, 100=明示再処理 |
| `reason` | `'new'` / `'reprocess'` |
| `status` | `queued` / `processing` / `succeeded` / `failed` |
| `attempt` | 失敗回数。`MAX_ENRICH_ATTEMPTS`(4)超で終端 |
| `lease_token`, `lease_expires_at` | claim時のlease（並行実行の排他） |
| `published_at`, `created_at` | 優先度内の新着順・投入順のソートキー |

### ワーカーの流れ（`AiEnrichWorker.runOnce`）

1. `reconcileEnrichQueue` — 期限切れleaseを`queued`へ戻す＋未処理記事を`reason='new', priority=0`で`INSERT OR IGNORE`。
2. ownerごとに `leaseEnrichBatch` を `BEGIN IMMEDIATE` トランザクション内で `SELECT→UPDATE` し、
   `priority ASC, published_at DESC` 順にclaim（日次上限・ownerあたり8件制限は従来どおり）。
3. 処理後 `completeEnrichBatch` で成功/失敗＋`attempt`/`error` を記録。失敗は次tickで再試行、上限超は終端。

### 明示再処理

- `POST /v1/me/enrich/reprocess`（設定の「全記事を再処理」）→ 処理済み記事を `reason='reprocess', priority=100` で投入。日次上限は適用（worker側）。
- `POST /v1/me/articles/{articleId}/enrich`（記事詳細の「AIで再計算」）→ 既存のオンデマンド再計算を維持。

### キュー状態ビュー

- `GET /v1/me/enrich/queue` — 処理中/待ち/失敗/直近/日次上限/再処理可能件数。
- `GET /v1/me/enrich/queue/events` — SSEスナップショットストリーム（変更時のみ送信、ハートビート付き）。
  WebはDialogを開いている間だけ購読し、切断時はGETポーリングへフォールバック（既存 `use-generation` パターン）。

## 判断要因

- プロフィール変更のたびに全件再スコアするのはコスト・実用の両面で過剰。明示再処理に切り替えてユーザーが制御する。
- 既存 `episode_jobs` のリースパターン（ADR-0016）を踏襲し、`BEGIN IMMEDIATE`+SELECT→UPDATEで二重処理を防ぐ。
- スナップショットSSEはイベントログ方式より単純で再接続も冪等。キュー状態のサイズは小さいため差分方式は不要。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| プロフィール変更を引き続き自動再処理にする | ユーザー要望（コスト・バッジ高止まり）に反する | N/A |
| イベントログ型SSE（`enrich_queue_events`＋`Last-Event-ID`差分） | 新テーブルとworker追記、クライアント状態機械が必要。スナップショットで十分 | キュー状態が大きくなり全量送信が重くなる場合 |
| 明示再処理を日次上限の対象外にする | コスト爆発の恐れ。明示でも日次上限で分割処理し進捗を見せる | 明示再処理の即時完了が要件になった場合 |

## 結果

### 利点

- プロフィール編集・タグ追加で「AI処理待ち」が膨らまなくなる。
- 処理中/待ち/失敗/日次上限がリアルタイムに見え、明示再処理の進捗も追える。
- 優先度（新着・未処理→明示再処理）で自動バッチの価値が先に届く。

### 欠点とリスク

- プロフィール変更後、明示再処理するまで古いスコアのまま（表示は維持されるが新プロフィール準拠ではない）。
- キュー行はowner×記事で有界に保たれるが、`succeeded`履歴も残るため削除しない限り蓄積する。
- 失敗上限（`MAX_ENRICH_ATTEMPTS`）到達記事は自動再試行されない（明示再処理で復帰可能）。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | ADR-0021のプロフィール再計算方針を本ADRで一部置換 | Done | 本ファイル |
| データ/ストレージ | `enrich_queue`（migration `0014_enrich_queue.sql`） | Done | `packages/adapters/migrations/0014_enrich_queue.sql` |
| コード/ポート | `LocalStore`キューAPI、`AiEnrichWorker`キュー化、`attachAiEnrichment`最新スコア化 | Done | `packages/adapters/src/db/local-store.ts`, `packages/adapters/src/ai-enrich/enrich-worker.ts` |
| OpenAPI/外部契約 | `GET /v1/me/enrich/queue`, `GET /v1/me/enrich/queue/events`, `POST /v1/me/enrich/reprocess` | Done | `packages/contracts/openapi/openapi.json`, `pnpm contract:lint` |
| 実行/配備 | 変更なし（workerのtickで`runOnce`がreconcileする） | Done | `apps/worker/src/node.ts` |
| フロント/品質保証 | バッジ→Dialog（SSE）、設定「AI処理」パネル、記事詳細「AIで再計算」 | Done | `apps/web/src/routes/_authenticated/**` |
| テスト/運用 | キュー遷移・優先度・明示再処理・最新スコア・SSE | Done | 下記検証証拠 |

## 再検討条件

- キュー状態が大きくなりスナップショット送信が重くなった場合、イベントログ型SSEへの移行を検討する。
- 明示再処理の即時完了が求められた場合、日次上限の別枠化を検討する。

## 受け入れゲートと未決事項

- None

## 検証証拠

- `cd packages/adapters && npx vitest run`（154 tests 全パス）
- `cd apps/api && npx vitest run`（44 tests 全パス。enrich queue/reprocess/events 含む）
- `cd apps/worker && npx vitest run`（14 tests 全パス）
- `cd apps/web && npx vitest run`（130 tests 全パス）
- `pnpm typecheck`（全パッケージ成功）、`pnpm lint`（クリーン）、`pnpm test:visual`（7 tests 全パス）
