# ADR-0002: OpenAPI-first RESTと非同期エピソードジョブを採用する

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / API
- Supersedes: N/A
- Superseded by: ADR-0008（契約正本のみ）、[ADR-0055](0055-same-origin-web-and-audio-delivery.md)（音声配信契約のみ）
- Related: `packages/contracts/openapi/openapi.json`

## コンテキストと変更契機

RSS取得、LLM要約、TTSはHTTP要求中に完了させるには重く、再試行と重複要求を扱う必要がある。Webと二つのbackend実装で契約を一致させる必要もある。

## 決定

YAML OpenAPIをHTTP契約の正本とする。生成開始は `POST /v1/episode-jobs` が `202 + Location` を返し、必須 `Idempotency-Key` と状態 `queued/running/succeeded/failed/canceled` を契約化する。owner scope、Problem Details、cursor paging、短期音声URLを共通契約に含める。

## 判断要因

- 長時間処理をrequest lifecycleから分離する。
- local/cloudの重複配送でも一つの論理ジョブにする。
- frontend/server/contract testの不一致を生成型で検出する。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| 同期 `POST /episodes` | timeoutと部分失敗を隠せない | 全段階が安定して短時間になる |
| Hono code-firstを契約源にする | runtime実装に正本が寄る | OpenAPI-first要件が撤回される |
| 生成時にsigned URLをEpisodeへ保存 | 期限と認可が永続表現へ混入する | 音声が完全公開になる |

## 結果

### 利点

- 冪等再送、状態追跡、retryable failureを明示できる。

### 欠点とリスク

- job storage、lease、outbox、reconcilerが必要になる。
- 未確定の生成入力をOpenAPIで早期固定できない。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | 状態と冪等性 | Done | `docs/design.md` 4-5章 |
| ドメイン/ユースケース | 状態機械 | Done | `packages/domain/src/episode-job.ts` |
| OpenAPI/外部契約 | 202/Location/headers/errors | Done | OpenAPI JSON（ADR-0008） |
| コード/ポート | routeは入力確認まで保留 | Pending | 確認ゲート |
| データ/ストレージ | unique idempotency + outbox | Done | migration 0001 |
| 実行/配備 | Worker分離 | Done | `apps/worker` |
| 認証/セキュリティ | owner scope | Done | OpenAPI descriptions |
| フロント/品質保証 | polling states | Pending | 機能画面の承認後 |
| テスト/運用 | 状態遷移unit test | Done | domain tests |

## 再検討条件

- pipelineが十分短くなり非同期運用コストが便益を上回る実測が得られる。

## 受け入れゲートと未決事項

- job request body、cancel/retry UI、Idempotency-Key保持期間。

## 検証証拠

- OpenAPI validation、状態遷移test。
