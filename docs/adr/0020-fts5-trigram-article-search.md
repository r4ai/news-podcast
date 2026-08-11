# ADR-0020: 記事検索をSQLite FTS5(trigram)へ移行する

- Status: Accepted
- Date: 2026-08-11
- Decision owners: Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: ADR-0003（node:sqlite/D1二系統）、ADR-0019、`packages/adapters/src/db/local-store.ts`

## コンテキストと変更契機

`articleSearchPredicate()` は `LIKE '%q%'` で `feed_items.title`/`summary`/`feed_catalog.name` を線形スキャンしていた。ADR-0019で述語を独立関数へ切り出した際、この移行が想定されていた（却下案「SQLite FTS5を検索の初期実装にする」の再検討条件）。想定規模が数万件以上に伸びる前提のため、インデックスを使わないLIKEでは検索レイテンシがレコード数に比例して悪化する。

記事本文のMarkdownはDBではなくオブジェクトストアにある（`article_snapshots.markdown_key`）。`feed_items` にはtitleとsummaryしかなく、本文全文検索を実現するには「本文をどこかに複製して索引に載せる」工程が要る。

## 決定

`packages/adapters/migrations/0010_article_search_fts.sql` で `feed_items_fts` というFTS5仮想テーブルを追加する。

- **トークナイザは `trigram`** を使う。理由は日本語が空白で語を区切らないため既定の `unicode61` トークナイザでは複合語の部分一致（例:「全文検索」で「日本語全文検索を実用にする」を拾う）ができないこと。trigramは3文字以上の任意の部分文字列に一致するため、日英どちらの部分一致検索も同じ仕組みで扱える。代償として索引サイズは元テキストの3〜4倍に膨らむが、記事検索を実用にするコストとして許容する。
- **`content=` の外部コンテンツ方式は使わない。独立したFTS5テーブルにする。** 理由は二つ: (1) 本文(body)が `feed_items` に存在しないため、外部コンテンツ方式が要求する「元テーブルに全列が揃っている」前提を満たせない。(2) `feed_items.id` はTEXT主キーで、外部コンテンツ方式が使う `content_rowid` の整合を取るには追加の変換が要る。代わりに `feed_items` の暗黙のrowidをそのまま `feed_items_fts` のrowidとして明示的に書き込み、`i.rowid IN (SELECT rowid FROM feed_items_fts WHERE feed_items_fts MATCH ?)` で結合する。
- 列は `title` / `summary` / `body` の3つ。title/summaryは `feed_items` へのINSERT/UPDATE(ON CONFLICT DO UPDATEも含む)/DELETEトリガで同期する。bodyは索引に含めるが同期元のテーブルが存在しないため、ワーカーが後から書き込む（`body_indexed_at` UNINDEXED列をNULLのままにして未投入を判別する）。
- `apps/worker/src/process-rss-archive.ts` の `RssArchiveWorker` にアーカイブ成功直後の即時投入（`indexArticleBody`）と、既存の未投入分を拾う `backfillSearchBody(limit)` を追加した。`runOnce()` は毎tick、アーカイブ処理の後に小バッチ（5件）でバックフィルを進める。投入失敗はアーカイブの成否に影響させず、次回のバックフィルで再試行する。
- `articleSearchPredicate()` をFTS5 MATCHを使う形に差し替えた。ソース名(`f.name`)はFTS索引に含まれないため、常に別枠のLIKE述語をORで足す（フィード数は少なくコストは無視できる）。
- **1〜2文字のクエリはLIKEにフォールバックする。** trigramは3文字未満のクエリに一切マッチしないため、フォールバックが無いと短いクエリが無言でゼロ件になる。コードポイント数（`[...q].length`）で判定し、日本語1〜2文字のクエリも正しくLIKEへ回す。
- **クエリ文字列は必ず二重引用符でくくったリテラルフレーズにする。** FTS5クエリ構文（`"`、`*`、`OR`、`NEAR` など）をユーザー入力がそのまま解釈してしまう事故を防ぐため、内部の `"` は `""` に二重化してエスケープし、常にフレーズ検索として扱う。

## 判断要因

- 想定規模（数万件以上）でLIKEの線形スキャンは許容できない。
- 日本語は分かち書きされないため、標準トークナイザでは実用的な部分一致検索にならない。trigramはこの制約を回避できる数少ない標準機能。
- D1（Cloudflare's SQLite）でも使える構文であることが必須（ADR-0003）。FTS5のtrigramトークナイザ・独立仮想テーブル・標準トリガはD1でも動作する標準SQLite機能であり、D1固有の非対応構文（拡張ロードなど）に依存しない。
- 本文はオブジェクトストアが原本のため、DBへ複製すると二重管理になる。索引だけに複製し、原本はオブジェクトストアのままにすることで責務を分離した。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| `unicode61`トークナイザ | 空白/記号で区切ったトークン単位でしか一致せず、日本語の複合語部分一致（「全文検索」で「日本語全文検索」を拾う）ができない | N/A |
| `content=`外部コンテンツ方式 | 元テーブル(`feed_items`)にbody列が無く、`content_rowid`の対応もTEXT主キーのままでは取れない | `feed_items`にbody相当の列を持たせる設計変更をする場合 |
| 本文MarkdownをDBの`feed_items`または新規カラムへ複製して保持する | オブジェクトストアとDBで本文の二重管理になり、アーカイブ再実行時の整合コストが増える。索引専用に複製すれば同じ問題を避けられる | 本文をDBだけで完結させたい別の要件が出た場合 |
| 短いクエリもFTS5のみで処理する | trigramは3文字未満に一切マッチせず、無言でゼロ件になりユーザーに検索結果ゼロと誤解させる | N/A |

## 結果

### 利点

- 数万件規模でも検索がインデックス経由になり、LIKEの線形スキャンから解放される。
- 日本語・英語どちらの部分一致検索も同じ仕組みで動く。
- 本文全文検索（body）が新たに可能になる。
- 既存のkeysetページネーションと`listArticleFacets`は述語を共有しているため、差し替えは`articleSearchPredicate()`一箇所に閉じている。

### 欠点とリスク

- 索引サイズが元テキストの3〜4倍に膨らむ。記事数がさらに増えた場合はディスク使用量の再評価が要る。
- 本文の索引投入はアーカイブと非同期（ワーカーのtickごと）なため、アーカイブ成功から本文検索がヒットするまでに数tick分のラグがありうる（バックフィルが失敗を次回に持ち越すため、恒久的に投入できない記事はほぼ発生しない想定だが、オブジェクトストア障害が続く場合は投入が滞留する）。
- ソース名(`f.name`)はFTS索引の対象外でLIKEのままのため、ソース名検索の性能特性は変わっていない（フィード数が少ない前提で許容）。
- D1環境での実地検証はまだ行っていない（本タスクの範囲はnode:sqlite側の実装とテストまで）。D1でのtrigramトークナイザ・仮想テーブルの動作は次のD1導入時に確認が要る。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | N/A — 本ADRが設計判断そのもの | Done | 本ファイル |
| ドメイン/ユースケース | N/A — DBアダプタ層とワーカーのみの変更 | Done | `packages/adapters/src/db/local-store.ts`、`apps/worker/src/process-rss-archive.ts` |
| OpenAPI/外部契約 | N/A — `/v1/me/articles` の`q`パラメータの意味は変わらない | Done | N/A |
| コード/ポート | `articleSearchPredicate()`のFTS5化、`setArticleSearchBody`/`listArticlesPendingBodyIndex`の追加 | Done | `packages/adapters/src/db/local-store.ts` |
| データ/ストレージ | `feed_items_fts`仮想テーブルとトリガを追加する新規マイグレーション | Done | `packages/adapters/migrations/0010_article_search_fts.sql` |
| 実行/配備 | `RssArchiveWorker`にアーカイブ後の即時本文投入とバックフィルを追加 | Done | `apps/worker/src/process-rss-archive.ts` |
| 認証/セキュリティ | owner scopeは既存のarticleFilterPredicate経由でそのまま維持（FTS述語自体はowner非依存） | Done | `packages/adapters/src/db/local-store.ts` |
| フロント/品質保証 | N/A — 本タスクは`apps/web`を対象外とする | Pending | 別エージェント |
| テスト/運用 | 日英部分一致、短クエリのLIKEフォールバック、特殊文字のリテラル化、本文限定検索、検索+ページネーション、owner isolation、facets一致、バックフィルの冪等性 | Done | `packages/adapters/src/db/local-store-articles.test.ts`、`apps/worker/src/process-rss-archive.test.ts` |

## 再検討条件

- D1導入時にtrigramトークナイザまたは仮想テーブル構文が非対応と判明した場合、D1側だけ別実装（例: 別サービスの全文検索）に切り替える。
- 索引サイズがディスク予算を超える場合、`body`列の保持期間や対象記事を絞る（例: 直近N件のみ本文索引を持つ）ことを検討する。
- 本文投入のラグが運用上問題になる場合、アーカイブ完了と索引投入を同一トランザクションに近づける設計（例: 即時投入の再試行回数を増やす）を検討する。

## 受け入れゲートと未決事項

- None

## 検証証拠

- `cd packages/adapters && npx vitest run`（67 tests, 全パス）
- `cd apps/worker && npx vitest run`（13 tests, 全パス）
- `npx oxlint packages/adapters apps/worker`（クリーン）
- `cd packages/adapters && npx tsc --noEmit`（クリーン）
- `cd apps/worker && npx tsc --noEmit`（`packages/adapters/src/archive/html-to-markdown.ts`の`turndown-plugin-gfm`型エラーのみ残存。これは本タスクの対象外である`packages/adapters/src/archive/`配下の既存作業に起因し、本ADRの変更とは無関係）
