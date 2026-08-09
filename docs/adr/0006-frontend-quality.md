# ADR-0006: Storybook中心のフロントエンド品質保証を採用する

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / Frontend
- Supersedes: N/A
- Superseded by: N/A
- Related: `apps/web/.storybook`

## コンテキストと変更契機

非同期処理にはloading、queued、running、succeeded、failed、canceled、empty、permission errorなど多数の視覚状態がある。カバレッジ率だけでは表示崩れ、操作、アクセシビリティを検出できない。

## 決定

shadcn/ui neutral + Base UIを使い、Storybookを状態の確認面にする。各機能は状態別story、interaction test、a11y検査、Playwright screenshot差分を持つ。全体カバレッジ閾値は設定しない。

レスポンシブ構成は、PCを高密度な左navigation + 2カラム、モバイルを1カラム + 下部navigationとする。モバイルの主要tap targetは44px以上、safe area対応、semantic landmark、キーボードfocus、`aria-current`、状態を表すARIAを受け入れ条件に含める。視覚階層はneutral token、余白、境界線、既存radiusで作り、独自の派手な装飾を品質向上の代替にしない。

## 判断要因

- 状態をAPI実通信なしで再現できる。
- 視覚、操作、a11yを別の失敗理由で検査できる。
- UI本実装前にデザイン承認を維持できる。

## 却下案

| 案                          | 却下理由                                        | 再検討条件                                   |
| --------------------------- | ----------------------------------------------- | -------------------------------------------- |
| E2Eだけ                     | failure再現が遅く不安定                         | 状態数が極端に少なくなる                     |
| snapshot markupだけ         | 視覚と操作を検証できない                        | rendererが視覚差分を完全に表現できる         |
| 全体coverage threshold      | 契約充足を保証せず冗長testを促す                | 契約単位の明確な局所基準が必要になる         |
| PC/モバイル共通の縮小layout | 情報密度かtap targetのどちらかを損なう          | 入力方式と画面幅の差がなくなる               |
| 画面ごとの独自breakpoint    | 回帰範囲と認知負荷が増える                      | 標準breakpointでは実測した崩れを解決できない |
| 装飾で階層を強調            | neutral方針と可読性を損ね、状態理解に寄与しない | 装飾自体がプロダクト要件になる               |

## 結果

### 利点

- UI状態を独立にレビュー・回帰検査できる。

### 欠点とリスク

- browser baselineの更新手順と環境固定が必要。

## 影響と同期

| 対象                  | 必要な変更             | 状態    | 証拠                       |
| --------------------- | ---------------------- | ------- | -------------------------- |
| 設計書                | QA層                   | Done    | `docs/design.md`           |
| ドメイン/ユースケース | N/A — 表示から独立     | Done    | N/A                        |
| OpenAPI/外部契約      | generated types        | Pending | client生成後               |
| コード/ポート         | UI state fixtures      | Done    | `PodcastDashboard` stories |
| データ/ストレージ     | N/A — story fixture    | Done    | N/A                        |
| 実行/配備             | static Storybook build | Done    | web scripts                |
| 認証/セキュリティ     | auth states            | Done    | login route / E2E          |
| フロント/品質保証     | Storybook/a11y/visual  | Done    | scaffold config            |
| テスト/運用           | browser commands       | Done    | web scripts                |

## 再検討条件

- StorybookまたはPlaywrightが対象runtimeを継続的に支援しなくなる。

## 受け入れゲートと未決事項

- 実データ接続時にloading、failed、canceled、permission errorを同じ画面階層で追加する。
- 音声playerの実duration、seek、期限切れURL更新はaudio access統合時に検証する。

## 検証証拠

- Storybook build、`ready/running/succeeded` stories、desktop/mobile Playwright visual baseline、interaction、a11y検査。
