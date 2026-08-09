# ADR-0007: 事実ベース台本にRSS出典provenanceを保持する

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / Editorial
- Supersedes: N/A
- Superseded by: N/A
- Related: SummaryGenerator port

## コンテキストと変更契機

LLM要約には誤りの可能性があり、RSS項目との対応を追跡できなければ「事実ベース」を検査できない。リンク先本文を取得するかは未確定である。

## 決定

生成入力は取得したRSS項目を正準source itemとして保持し、台本成果物は参照したsource URL集合を返す。providerの自由生成だけを保存しない。本文取得、引用粒度、UI表示は確認ゲートまで確定しない。

## 判断要因

- 生成結果を出典へ遡れること。
- 取得範囲をRSS-only制約内に保つこと。
- provider差し替え時も同じprovenance契約を維持すること。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| 台本文字列だけ保存 | 根拠を検査できない | 事実ベース要件が撤回される |
| 自動でリンク先全文を取得 | RSS-only範囲とSSRF/著作権判断を先取りする | ユーザーが明示的に許可し取得方針を決める |
| LLM内蔵web searchを使う | ニュース源RSSのみの要件に反する | ニュース源要件が変更される |

## 結果

### 利点

- episodeから入力RSS項目へ追跡できる。

### 欠点とリスク

- RSS descriptionだけでは十分な事実確認ができない場合がある。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | provenance方針 | Done | `docs/design.md` |
| ドメイン/ユースケース | source item/draft types | Done | application ports |
| OpenAPI/外部契約 | EpisodeSource | Done | OpenAPI JSON（ADR-0008） |
| コード/ポート | SummaryGenerator result | Done | application/adapters |
| データ/ストレージ | episode_sources | Done | migration 0001 |
| 実行/配備 | N/A — 共通規則 | Done | N/A |
| 認証/セキュリティ | N/A — owner認可は別ADR | Done | ADR-0005 |
| フロント/品質保証 | source表示 | Pending | 確認ゲート |
| テスト/運用 | adapter output validation | Done | mock-based tests |

## 再検討条件

- RSS内容だけでは品質目標を満たさない測定結果が得られる。

## 受け入れゲートと未決事項

- リンク先本文取得、引用粒度、台本内出典表現、事実確認UI。

## 検証証拠

- adapter/config test、OpenAPI schema validation。
