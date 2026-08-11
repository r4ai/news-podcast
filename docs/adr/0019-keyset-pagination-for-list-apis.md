# ADR-0019: 全リストAPIをkeysetページネーション契約へ揃える

- Status: Accepted
- Date: 2026-08-10
- Decision owners: Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: ADR-0008、OpenAPI `page()` ヘルパ、`/v1/me/articles`

## コンテキストと変更契機

`apps/api/src/http/schemas.ts` の `page()` ヘルパは `page: z.object({ hasMore: z.literal(false) })` を返す。このヘルパは feeds、subscriptions、articles、episode-jobs、agent-runs/events、agent-instances、agent-memories、episodes の全リストエンドポイントで共有されている。`hasMore` が型レベルで常に `false` に固定されているため、どのリストAPIも仕様上「次ページは存在しない」と宣言していることになる。

実害が最初に出たのは記事一覧である。`/v1/me/articles` はサーバ側で100件までしか返さず、絞り込みも並び替えもクライアントに丸投げしていた。フィードやRSS取り込みが数万件規模になると、クライアントは全件を毎回受信してからJSでフィルタする必要があり、応答サイズとレンダリング負荷が線形に破綻する。この変更契機は記事一覧だが、`page()` は共有ヘルパのため、修正はここを直せば全リストAPIの契約に波及する。

offsetページネーションではなく、SQLiteの既存インデックス `idx_feed_items_feed_published (feed_id, published_at DESC, discovered_at DESC)` が効くkeyset方式を選ぶ。offsetはOFFSET N分の行をスキャンするため件数が増えるほど遅くなり、かつページ境界をまたぐ挿入で重複や欠落が起きる。keysetは「直前ページ最後の行のソートキー」を境界値として `WHERE (sort_key, id) < (?, ?)` 型の述語で絞るため、インデックスシークで完結し、途中挿入があっても既に返した範囲は不変である。

## 決定

`page()` を `page: z.object({ hasMore: z.boolean(), nextCursor: z.string().optional() })` に変更する。`hasMore: false` は引き続き有効な値なので、まだcursorページネーションを実装しないエンドポイント（feeds、subscriptions、episode-jobs、agent-runs/events、agent-instances、agent-memories、episodes）は応答を変更しなくてよい。

`/v1/me/articles` はこの契約を最初に実際に使う。cursorは `(sort_key, id)` の複合キーをJSON配列にしてbase64url符号化したものとし、ソートモード（`newest` | `oldest` | `source`）ごとに異なる列順を許す。`sort_key = COALESCE(published_at, discovered_at)` は既存インデックスの列順と一致させ、`source` ソートでも `f.name, sort_key, id` の順でインデックスなしのフルスキャンにはなるが、複合キーの一意性（`id` を末尾に必ず含む）でページ境界の重複・欠落を防ぐ。

## 判断要因

- `page()` は全リストAPI共通のため、cursor対応を型レベルで先に許可しておかないと記事一覧以外のエンドポイントも後で契約を壊す変更になる。
- keysetは既存インデックスと相性が良く、offsetのような「ページが進むほど遅くなる」問題が起きない。
- `hasMore: boolean` は既存の `hasMore: false` と後方互換であり、cursor未対応のエンドポイントは変更不要。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| offset/limitページネーション | 件数が増えるとOFFSET分のスキャンコストが線形に増え、途中挿入で重複・欠落が起きる | 記事数が常に小さく上限が明確な場合 |
| `page()` を触らず記事一覧だけ独自のページ契約にする | 共有ヘルパの型と実態が乖離し、他エンドポイントを後から直す際にまた契約変更が要る | N/A（今回まとめて直す） |
| SQLite FTS5を検索の初期実装にする | 移行手順とインデックス構築が本タスクの範囲を超え、LIKE述語で十分な規模から始めたい | 記事数または検索レイテンシがLIKEで許容できなくなる |

## 結果

### 利点

- 全リストAPIの契約が「次ページがあるかもしれない」ことを表現できるようになる。
- 記事一覧が数万件規模でも応答時間とペイロードが有界になる。
- 検索述語 (`articleSearchPredicate`) を独立関数に切り出したため、後でFTS5に差し替える際の変更範囲が局所化される。

### 欠点とリスク

- cursorはソートモードごとに列構成が異なるため、クライアントがソートを変えたら新しいcursorから開始する必要がある（`cursor` と `sort` の組み合わせが変わった場合の互換性はAPIが保証しない）。
- `source` ソートは `feed_id`/`published_at` の複合インデックスを使えず、フルスキャン＋ソートになる。将来的に `(feed_id 経由の) source_name` 用インデックスが要る可能性がある。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | N/A — 本ADRが設計判断そのもの | Done | 本ファイル |
| ドメイン/ユースケース | N/A — DBアダプタ層のみの変更 | Done | `packages/adapters/src/db/local-store.ts` |
| OpenAPI/外部契約 | `page()` の `hasMore`/`nextCursor`、`/v1/me/articles` の query、`/v1/me/articles/facets` 追加 | Done | `packages/contracts/openapi/openapi.json` |
| コード/ポート | keyset述語ビルダー、検索/状態/フィード述語ビルダー | Done | `packages/adapters/src/db/local-store.ts` |
| データ/ストレージ | 既存インデックス `idx_feed_items_feed_published` を再利用、新規マイグレーション不要 | Done | `packages/adapters/migrations/0005_rss_archive_agent.sql` |
| 実行/配備 | N/A — ランタイム構成に変更なし | Done | N/A |
| 認証/セキュリティ | owner scope (`feed_subscriptions.owner_id`、`enabled = 1`) を全クエリで維持 | Done | `packages/adapters/src/db/local-store.ts` |
| フロント/品質保証 | N/A — 本タスクは `apps/web` を対象外とする | Pending | 別エージェント |
| テスト/運用 | 境界重複・欠落、owner isolation、検索/絞り込み/並び替えの組み合わせテスト | Done | `packages/adapters/src/db/local-store-rss.test.ts`、`apps/api/src/app.test.ts` |

## 再検討条件

- `source` ソートのレイテンシがフルスキャンで許容できなくなった場合、`(feed_id, source_name)` 相当のインデックスまたは非正規化列を追加する。
- LIKE検索のレイテンシまたは精度が要件を満たさなくなった場合、FTS5仮想テーブルへ切り替える。

## 受け入れゲートと未決事項

- None

## 検証証拠

- `pnpm vitest run`（`apps/api`、`packages/adapters`）
- `npx oxlint apps/api packages/adapters`
- `npx tsc --noEmit`（`apps/api`、`packages/adapters`、`packages/contracts`）
- `pnpm contract:generate` / `pnpm contract:lint`
