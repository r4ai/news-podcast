# ADR-0009: TanStack Router/QueryとAsync Reactを採用する

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / Web
- Supersedes: N/A
- Superseded by: N/A
- Related: `apps/web/src/routes`, `apps/web/src/features`

## コンテキストと変更契機

生成ジョブは長時間状態遷移し、購読・設定・ライブラリは独立して取得と失敗を扱う必要がある。

## 決定

file-based TanStack Routerでroute preloadとcode splittingを行い、TanStack QueryのSuspense queryをserver stateの正本にする。表示境界はroute/独立パネル単位とし、更新はReact 19のTransition、購読変更はAction内の`useOptimistic`で即時反映する。確定状態は常にserver responseとする。

## 判断要因

- navigationとquery cacheを協調させる。
- 既存表示を維持したまま更新する。
- 通信、表示model、presentational UIを分離する。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| component内の直接fetch | cache、polling、error resetが分散する | 単発の静的画面のみになる |
| 全画面一つのSuspense | 独立パネルまで同時に隠れる | 画面が単一queryだけになる |

## 結果

非同期状態の設計は明示的になる一方、route generatorとquery invalidationを品質ゲートで検証する必要がある。

## 検証証拠

- `pnpm --filter web build`
- `pnpm storybook:build`
