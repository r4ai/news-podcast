# ADR-0001: DDDとオニオンアーキテクチャを採用する

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / Architecture
- Supersedes: N/A
- Superseded by: ADR-0034
- Related: `docs/design.md` 3章

## コンテキストと変更契機

RSS、要約、TTS、認証、ジョブ、二つの配備形態は異なる変更理由を持つ。外部SDKや配備都合がドメイン規則へ流入すると、SQLite/D1やlocal/R2の差し替えが困難になる。

## 決定

モジュラーモノリスをDDDで境界づけ、依存方向を `domain <- application <- adapters <- apps` に限定する。外部依存はapplicationが所有するポートをadapterが実装し、実行環境別composition rootで組み立てる。

## 判断要因

- ドメイン規則を外部技術から独立して100%単体検証できること。
- オンプレミスとCloudflareで中核を共有できること。
- 未確定ユースケースを外側の都合から推測しないこと。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| 技術別レイヤーだけのCRUD | 所有権とジョブ不変条件がroute/DBへ分散する | ドメイン規則が実質なくなる |
| 初期からマイクロサービス | 分散整合性と運用面を先に増やす | 独立スケール/組織境界が実測で必要になる |
| 外部依存ごとに単一実装interfaceを作る | 仮想的なseamが増える | production/testまたはlocal/cloudの2 adapterが必要になる |

## 結果

### 利点

- ドメインとユースケースをruntime非依存に保てる。
- adapter契約テストをlocal/cloudで共有できる。

### 欠点とリスク

- module間DTO変換とcomposition rootの管理が必要になる。
- 浅い委譲moduleを増やすと逆に複雑になる。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | 依存図とmodule責務 | Done | `docs/design.md` |
| ドメイン/ユースケース | runtime非依存package | Done | `packages/domain`, `packages/application` |
| OpenAPI/外部契約 | HTTP DTOをdomainへ流さない | Done | `packages/contracts` |
| コード/ポート | application-owned ports | Done | `packages/application/src/ports.ts` |
| データ/ストレージ | adapter側へ隔離 | Done | `packages/adapters` |
| 実行/配備 | runtime別composition root | Done | `apps/api`, `apps/worker` |
| 認証/セキュリティ | adapterへ隔離 | Done | `packages/adapters/src/auth` |
| フロント/品質保証 | generated contractだけに依存 | Pending | 機能確認ゲート後 |
| テスト/運用 | interfaceをテスト面にする | Done | domain tests |

## 再検討条件

- moduleごとに独立配備/スケールが必要な測定結果または組織所有境界が生じる。

## 受け入れゲートと未決事項

- 機能ユースケースの境界内操作は `docs/design.md` 9章の確認待ち。

## 検証証拠

- workspace typecheckとdomain unit test。
