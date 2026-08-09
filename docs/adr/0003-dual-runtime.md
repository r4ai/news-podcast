# ADR-0003: SQLite/DockerとD1/Cloudflareの二系統をcomposition rootで分離する

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: `docs/design.md` 6章

## コンテキストと変更契機

オンプレミスではCompose+SQLite、managed環境ではWorkers+D1+R2+Queuesが必要である。Node native依存をWorkers bundleへ混ぜず、同じドメイン規則を利用したい。

## 決定

API/Workerのcomposition rootをlocalとcloudで分ける。localはSQLite job table、polling worker、local audioを使い、cloudはD1、Queues、R2を使う。共通SQL制約とadapter contractを共有し、runtime固有exportを明示する。

## 判断要因

- 単一中核と二つの配備受け入れ。
- Node native moduleをWorkersから排除。
- at-least-onceとDB pollingの差をportの内側へ隠す。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| runtime条件分岐を一つのentryへ集約 | bundle汚染と分岐増加 | build toolが完全にdead-code eliminationを保証する |
| localも外部queue/object storageを必須化 | オンプレ単純性を失う | 運用標準が統一される |
| cloudでSQLite互換層を利用 | D1/Queuesの性質を隠せない | 公式に同一トランザクション意味論が提供される |

## 結果

### 利点

- runtimeごとの最小依存と独立dry-runが可能。

### 欠点とリスク

- adapter contract testを両実装へ適用する必要がある。
- D1→Queueにはoutboxが必要。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | topology表 | Done | `docs/design.md` |
| ドメイン/ユースケース | N/A — runtime非依存 | Done | package dependencies |
| OpenAPI/外部契約 | N/A — 同一契約 | Done | OpenAPI YAML |
| コード/ポート | runtime別composition | Done | `apps/api`, `apps/worker` |
| データ/ストレージ | 共通schema/outbox | Done | migration 0001 |
| 実行/配備 | Compose/Wrangler | Done | `infra`, wrangler files |
| 認証/セキュリティ | SQLite/D1 adapter | Partial | D1 wiringは機能実装時 |
| フロント/品質保証 | N/A — 同一HTTP契約 | Done | contract dependency |
| テスト/運用 | build/dry-run | Pending | cloud資格情報不要dry-run |

## 再検討条件

- 片方の配備形態を正式に廃止する判断がある。

## 受け入れゲートと未決事項

- Cloudflareから外部VOICEVOXへの到達方式と認証。

## 検証証拠

- workspace build、Compose config、Wrangler dry-run。
