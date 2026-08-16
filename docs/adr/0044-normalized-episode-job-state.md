# ADR-0044: episode_jobs の状態を列へ正規化しトリガをアプリ層へ移す

- Status: Accepted
- Date: 2026-08-15
- Decision owners: Platform
- Supersedes: N/A
- Superseded by: ADR-0058（状態イベントをdurable AG-UIへ置換）
- Related: ADR-0016（観測可能な有界実行）、ADR-0036（永続的なサービス整合性）、ADR-0043

## コンテキストと変更契機

**確認済みの事実**

`episode_jobs` はジョブ状態機械の全体を `document TEXT`（JSON）1列に格納していた。その結果:

- 状態の参照が `json_extract(document, '$._tag')` に依存し、式インデックスでしか引けなかった
- 状態イベントの記録が**2つのトリガ**（INSERT時とUPDATE時）に埋まっており、
  記録条件がスキーマ側に隠れていた
- 「どの状態でどの項目が埋まるか」がコード側の約束でしかなく、DBは何も拘束していなかった
- `createdAt` を後付けした際、起動時に全行を書き換える backfill UPDATE が必要になった
- `listOwned` が `rowid DESC` 順に暗黙依存していた（挿入順であって作成順ではない）

## 決定

状態機械を実カラムへ分解する。

| 現状 | 変更後 |
| --- | --- |
| `document TEXT`（タグ付きユニオンのJSON） | `status` / `attempt` / 各状態の時刻 / `lease_token` / `leased_until` / `failure_code` / `failure_retryable` / `episode_id` / `cancel_reason` |
| `request.articleIds` がJSON配列 | 子テーブル `episode_job_articles(job_id, position, article_id)` |
| トリガ2本が status イベントを materialize | 遷移を書く側が同一トランザクションで明示的に insert |
| 式インデックス `json_extract(document,'$._tag')` | 通常インデックス `(status, job_id)` |
| `rowid DESC` 順 | `(owner_id, created_at DESC, job_id DESC)` |

状態ごとに揃うべき列はテーブルのCHECK制約として表明する
（`Running` ならリース必須、`Succeeded` なら `episode_id` 必須、など）。

イベントログはpayload JSONを残す。本ADRでは`episode_job_status_events`を
前提としたが、ADR-0058で公式event envelopeを保存する
`episode_job_agui_events`へ一括置換した。状態更新とevent追記を同じtransactionに
置くという原則は維持する。

ドメイン ↔ 行の変換は `adapters/persistence/job/state-columns.ts` に集約し、
`EpisodeJobSchema` を唯一の正とする。

## 判断要因

- 状態遷移がSQLからもコードからも追えること
- 「あり得ない行」をDBが拒めること
- 外部のストリーミング契約を変えないこと

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| document 列を維持する | ORM統一後も状態参照が式に依存し続け、CHECK制約による不変条件の表明もできない。トリガに記録条件が隠れたままになる | N/A |
| status イベントも完全正規化する | イベントは不変な記録であり、当時の姿をそのまま残すほうがストリーミング契約の維持に直結する。列へ分解すると復元ロジックが二重化する | イベントに対する集計問い合わせが必要になった場合 |

## 結果

### 利点

- 状態の探索が通常インデックスで解ける
- 記録条件がスキーマではなくコードに現れ、テストで固定できる
- `created_at` が NOT NULL 列になり、起動時 backfill UPDATE が不要になった
- 不整合な行（リースの無い `Running` など）をDBが拒否する

### 欠点とリスク

- 状態を1つ増やすとき、列とCHECK制約とコーデックの3箇所を触る
- 行↔ドメインの変換コストが読み出しごとに乗る（測定可能な劣化は確認していない）

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | 永続化の記述を更新 | Done | `docs/architecture.md` |
| ドメイン/ユースケース | 変更なし（状態機械は不変） | Done | `services/episode-production/src/domain/episode-job.ts` |
| OpenAPI/外部契約 | 変更なし | Done | `pnpm contract:check` |
| コード/ポート | ハンドル契約（document文字列）は維持 | Done | `adapters/persistence/job/ports.ts` |
| データ/ストレージ | 初期マイグレーションで新スキーマを作成。既存volumeは作り直し | Done | `services/episode-production/drizzle/migrations` |
| 実行/配備 | 変更なし | Done | N/A |
| 認証/セキュリティ | 変更なし | Done | N/A |
| フロント/品質保証 | 変更なし | Done | N/A |
| テスト/運用 | 全状態の往復とイベント記録条件を固定 | Done | `state-columns.test.ts`, `status-events.test.ts` |

## 再検討条件

- 状態イベントに対する集計問い合わせが必要になったら、イベント側の正規化を再検討する

## 受け入れゲートと未決事項

- None

## 検証証拠

- `state-columns.test.ts`（全6状態の往復・不整合行の拒否・冪等指紋の不変性）
- `status-events.test.ts`（トリガ相当の記録条件）
- リース・フェンシング・冪等性を検証する既存20件のテストが実質無変更で通過
