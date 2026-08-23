# ADR-0046: 外部provider契約は実証調査を実装より先に行う

- Status: Accepted
- Date: 2026-08-15
- Decision owners: Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: ADR-0004、ADR-0011、ADR-0012、ADR-0026、ADR-0080、`docs/external-provider-contracts.md`

## コンテキストと変更契機

VOICEVOXはHTTP 200の`AudioQuery`へ追加されたoptional fieldをstrict parserが拒否し、正常応答を`MalformedResponse`にした。fixtureとproducer/consumer片側testだけでは外部契約driftを検出できなかった。

## 決定

外部境界は「公式仕様 → 稼働version/digest → 実データ」の順で調査し、一致後にRed test、projection、strict parseを実装する。provider-only fieldは必要項目へ明示projectionし、未知fieldを無条件許可しない。矛盾時はDTOを広げず停止する。

container provider（VOICEVOX 24.04、SeaweedFS 4.21）は検証済みdigestへ固定する。OpenAIは`gpt-5.6-luna` aliasを維持し、台本と記事補完の両方を同数のlive contract testと匿名fixtureで検証する。試行数は既定3、最大25/adapterの論理sampleとし、retryによる上限超過を禁止する。台本は公開前quality gateを含むため1 sampleあたり2 request、記事補完は1 requestで、上限は合計75 requestとなる。

## 判断要因

- 外部仕様変更の早期検出、再現可能なoffline CI、秘密/本文/IDを残さない証拠管理。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| responseをpassthroughで許容 | 未知契約をapplicationへ持ち込む | N/A |
| tagだけ固定 | 同じtagの再配布で再現性がない | signed immutable tagが保証された場合 |
| OpenAI aliasをsnapshotへ常時固定 | availabilityと移行性を損なう | alias driftが運用上許容不能になった場合 |

## 結果

### 利点

- 契約根拠と観測値をreviewでき、offline testへ再生できる。

### 欠点とリスク

- live refreshは資格情報、local provider、明示実行を要し、通常CIでは実行できない。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | discovery gate | Done | `docs/external-provider-contracts.md` |
| OpenAPI/外部契約 | 匿名fixture | Done | `contracts/provider-contracts.json` |
| コード/ポート | VOICEVOX/OpenAI DTO | Done | provider adapters |
| 実行/配備 | container digest固定 | Done | `compose.yaml` |
| 認証/セキュリティ | key/本文を非保存 | Done | check script |
| テスト/運用 | check/refresh分離 | Done | root package scripts |

## 再検討条件

- provider version/model alias/deprecation、`*_malformed_response`増加、digest更新。

## 受け入れゲートと未決事項

- None

## 検証証拠

- `pnpm provider-contract:check`
- 2026-08-15のVOICEVOX WAV、SeaweedFS round trip、OpenAI累計12 request（修正後は両adapter 5回連続成功）、live feed safe-fetch実証。
