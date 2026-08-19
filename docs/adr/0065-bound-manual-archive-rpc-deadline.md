# ADR-0065: 手動記事archiveをend-to-end RPC deadlineで拘束する

- Status: Proposed
- Date: 2026-08-19
- Decision owners: Product owner / Content Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: Issue #23、`POST /v1/me/articles/{articleId}/archive`、ADR-0012、ADR-0041

## コンテキストと変更契機

手動archiveは外部HTTP取得、HTML変換、asset取得、S3保存を同期実行する。Content captureの既定timeoutは30秒だが、Gatewayの共通NATS timeoutは2秒だったため、正常処理中にGatewayだけが503を返し、その後Contentがsnapshotをcommitし得た。

## 決定

公開APIは同期契約を維持し、手動archiveだけにend-to-end deadlineを設ける。Gatewayは`CONTENT_ARCHIVE_TIMEOUT_MS`から30秒の`deadlineAt`を作り、archive RPCだけはさらに5秒の返信余裕を加えて待つ。Contentは受信時の残時間で処理全体を拘束し、期限切れならcaptureを開始せず、処理中の期限切れは中断してcommitしない。他のRPCは既定2秒を維持する。

```mermaid
sequenceDiagram
  participant G as Gateway
  participant N as NATS
  participant C as Content Knowledge
  G->>N: Archive(deadlineAt), request timeout 35s
  N->>C: owner-scoped command
  alt deadline expired while queued
    C-->>G: Rejected
  else remaining time exists
    C->>C: capture within remaining deadline
    alt completed by 30s
      C->>C: commit snapshot
      C-->>G: Archived / AlreadyArchived
    else deadline expires
      C->>C: interrupt capture; no commit
      C-->>G: Rejected before 35s
    end
  end
```

## 判断要因

- Gatewayの応答とContentのcommit可否を同じdeadlineに揃える。
- 長いarchiveだけを分離し、通常RPCの障害検出を2秒から遅らせない。
- 既存の同期レスポンスとWeb操作を変更せずに誤った失敗表示を除く。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| 全NATS RPCを35秒へ延長 | session・一覧等の障害検出まで遅くなる | 全RPCのSLOが長時間処理へ統一される |
| Gateway timeoutだけ35秒へ延長 | queue待ちで35秒を超えるとContentが後からcommitする不整合が残る | N/A |
| archiveをdurable非同期job化 | status契約・永続queue・UI変更が必要で、現行の単発手動操作には変更が大きい | archiveのp95が20秒超、再起動耐性または進捗表示が必要になる |

## 結果

### 利点

- 2〜30秒で完了する正常なcaptureをGatewayが早期503へしない。
- queue待ちや遅延がdeadlineを超えても、失敗応答後にsnapshotが新規commitされない。
- 通常RPCの2秒timeoutは維持される。

### 欠点とリスク

- 手動archive HTTPリクエストは最大約35秒開いたままになる。
- GatewayとContentは同じ`CONTENT_ARCHIVE_TIMEOUT_MS`を配備設定として共有する。
- 中断前にS3へ保存済みの未参照objectは残り得るため、将来のcleanup対象になる。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | archive専用deadlineと同期契約を明記 | Done | `docs/design.md` |
| ドメイン/ユースケース | N/A — archive結果語彙は不変 | Done | 契約差分なし |
| OpenAPI/外部契約 | N/A — HTTP shape/statusは不変 | Done | generated OpenAPI差分なし |
| コード/ポート | RPC timeout overrideと`deadlineAt`を追加 | Done | Gateway transport / protocols / Content RPC |
| データ/ストレージ | N/A — schema変更なし | Done | migrationなし |
| 実行/配備 | GatewayがContent capture timeoutから30秒+5秒を構成 | Done | Gateway env/runtime tests |
| 認証/セキュリティ | owner actor検証を維持 | Done | article RPC tests |
| フロント/品質保証 | N/A — 同期レスポンスを維持 | Done | Gateway contract不変 |
| テスト/運用 | 通常/専用timeout、期限前/期限切れを検証 | Done | Gateway / Content tests |

## 再検討条件

- archiveのp95が20秒、p99が30秒へ継続的に近づく。
- orphan objectの量が運用閾値を超える。
- 再起動後の再開、進捗表示、複数archiveの公平なqueueingが必要になる。

## 受け入れゲートと未決事項

- None。

## 検証証拠

- Red: archive RPCが通常RPCと同じ2秒timeoutを使うテスト。
- Green: archiveだけ35秒、payload deadlineは30秒、期限切れcaptureは中断、通常RPCは2秒を維持。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:coverage:functional`。
