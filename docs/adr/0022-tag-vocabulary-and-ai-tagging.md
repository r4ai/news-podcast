# ADR-0022: 固定タグ語彙とAIタグ付与のスコア付けバッチへの相乗り

- Status: Accepted
- Date: 2026-08-11
- Decision owners: Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: ADR-0021（AI補助の日次バッチ・プロンプト版管理・profile_hash設計を継承）、ADR-0019（keysetページネーション）、ADR-0020（FTS5・述語ビルダー方式）、ADR-0018（hookが状態・viewはprops）

## コンテキストと変更契機

タグはこのタスク（`docs`のタスク一覧「タグとAI結果の一覧統合」）で新規追加する最後の主要機能であり、ADR-0021で明示的にスコープ外とされていた「タグ自動付与」を実装する。確定済み仕様（ユーザーと合意済み、変更しない）:

- タグはユーザーが定義した語彙の中からAIが選ぶ。AIに自由生成させない。
- 語彙に無いタグをAIが出したくなった場合は別枠（提案）に溜め、UIで「このタグを作る」を出す。
- 要約は常に日本語。スコアは並べ替え軸の一つで、既定は新着順のまま（ADR-0021からの継続方針）。

既存資産: `enrich-worker.ts`のスコア付けバッチ（`RELEVANCE_BATCH_SIZE`件/コール、タイトル+要約のみ）、`openai-relevance-scorer.ts`のResponses API `json_schema strict`パターン、`local-store.ts`の述語ビルダー方式（`articleFeedIdsPredicate`等の隣に１つ足す形）、`article-toolbar.tsx`に事前に空けられていたタグチップの置き場所。

## 決定

### なぜ「AIが自由生成するタグ」を採用しなかったか

「React」「react」「React.js」のような表記ゆれが乱立すると、タグが絞り込み軸として機能しなくなる。ユーザーが定義した語彙に限定し、AIはその中から選ぶだけにすることで、タグの数と粒度をユーザーがコントロールできる状態を維持する。

### 語彙外タグの扱い: 別枠に溜めて手動昇格

AIが「この語彙には無いが付けたい」タグ名を出したくなるケース（新しい技術トレンドなど）を潰さないよう、`tag_suggestions`テーブルに別枠で溜める。ユーザーがUIの「このタグを作る」から明示的に`tags`へ昇格させた場合のみ、以後のAI候補（enum）に加わる。これにより「語彙の成長はユーザーの意思決定を必ず経由する」という不変条件を保つ。

### データモデル（`packages/adapters/migrations/0012_article_tags.sql`）

- `tags(id, owner_id, name, created_at)` — `(owner_id, name)`一意。ユーザーが定義した語彙そのもの。
- `article_tags(owner_id, feed_item_id, tag_id, source, confidence, created_at)` — 複合PK`(owner_id, feed_item_id, tag_id)`。`source IN ('manual', 'ai')`で手動付与とAI付与を区別する。**同じ記事に両方の行が共存できる**（`LocalStore.setArticleManualTags`は`source='manual'`の行だけを削除・再挿入し、AI付与行には触れない）。
- `tag_suggestions(owner_id, name, occurrences, last_seen_at)` — 複合PK`(owner_id, name)`。同名の提案が繰り返されたら`occurrences`を積み増すだけで、行は増えない。

`article_tags`を手動/AIで1テーブルに統合し`source`列で区別したのは、記事に付くタグの表示（`Article.tags`）が両者の和集合であればよく、絞り込み（`tagIds`述語）も由来を問わず動けばよいため。テーブルを分けると絞り込みクエリが2つのUNIONを要求され、既存の述語ビルダー方式（1述語=1関数）と噛み合わなくなる。

### AIタグ付与はスコア付けバッチに相乗りさせる（新規コールを追加しない）

ADR-0021のコスト設計（スコアは`RELEVANCE_BATCH_SIZE`件/コール）を壊さないため、タグ付与のための新しいAPI呼び出しは追加しない。`openai-relevance-scorer.ts`の構造化出力スキーマに`tags`（語彙のenum）と`suggested_tags`（自由文字列配列）を追加しただけで、`enrich-worker.ts`の`scoreBatch()`が同じ1コールの結果からスコアとタグを同時に受け取り、`LocalStore.saveAiArticleTags`/`recordTagSuggestions`へ振り分ける。

**語彙が空のときは`tags`/`suggested_tags`フィールド自体をJSON Schemaから外す。** `json_schema strict`モードでは`enum: []`（空配列）を持つプロパティは仕様上不正であり、構造化出力そのものが壊れる。`OpenAiRelevanceScorer.score()`は`tagVocabulary.length === 0`のとき、スキーマの`required`からもプロパティ定義からも`tags`/`suggested_tags`を除外し、システムプロンプトからもタグ付与の指示を外す。この場合`enrich-worker.ts`は空配列を受け取り、タグ付与を静かにスキップする。

タグごとの確信度は、AIが「選ぶ/選ばない」の二値選択で答える設計上（スコアのような連続値をAIに出させていない）意味を持たせにくいため、`article_tags.confidence`は固定値`1`を書き込む。将来AIに0-1の確信度を出させたくなった場合の拡張余地として列自体は残す。

### 記事一覧APIへのタグ絞り込み

`LocalStore.listArticles`/`listArticleFacets`の`ArticleListOptions`/`ArticleFacets`オプションに`tagIds`を1つ追加し、`articleFilterPredicate`の述語配列へ`articleTagsPredicate()`を1関数足すだけで対応した（既存の`articleFeedIdsPredicate`と同型）。`article_tags`は1記事に複数行あり得るため、JOINではなく`EXISTS`で絞り込み、重複行や既存のkeysetページネーションへの影響を避けている。

### AI結果の一覧統合（web）

- 一覧行のスニペットは`articleSnippet()`（AI要約のMarkdown冒頭の平文抽出`aiSummarySnippet()` → `summary`の順でフォールバック）に統一した。未処理記事でも空行にならない。
- 並べ替えに`sort=relevance`（既存のADR-0021実装）を「おすすめ順」ラベルで公開し、`shouldShowRelevanceScore(sort)`で**おすすめ順のときだけ**行にスコア数値を出す。他の並び順では出さない（確定仕様）。
- `article-toolbar.tsx`の空き位置に選択中タグのチップ（クリックで解除）を表示し、`article-filter-popover.tsx`に全タグのチェックボックス一覧を追加した（媒体絞り込みと同型のUI）。
- 「AI処理待ちN件」は新規エンドポイントを増やさず、`ArticleFacets`に`aiPending`（`LocalStore.countEnrichPending`、絞り込み条件に依存しない購読全体の未処理件数）を1フィールド足して既存の`/v1/me/articles/facets`から配信する。

### 興味プロフィール設定画面（web, `/settings`）

`docs/adr/0021`で追加された`interestProfile`の編集UIが未実装だったため、`/schedule`の`ScheduleForm`と同型（hookが状態、viewはprops、ADR-0018準拠）で追加した。保存前に「N件のスコアを再計算しますか」の確認ダイアログを1回挟む（Nは絞り込み無しの全記事数）。実際の再計算トリガーは新設せず、ADR-0021の既存メカニズム（`profile_hash`が変わった瞬間に該当owner全記事が「未処理」化し、次回バッチ/オンデマンドが拾う）にそのまま乗せている——ダイアログは新しい非同期処理の起点ではなく、既存の暗黙的な再処理を利用者に可視化するための確認である。同じ画面にタグ語彙の追加/削除と、AI提案からの「このタグを作る」導線も置く。

## 判断要因

- 語彙固定は「タグが絞り込み軸として機能し続けること」を最優先した結果であり、AIの表現力よりユーザビリティを取った。
- コスト設計（ADR-0021）を壊さないことを最優先し、新規コールを増やさず既存バッチへ相乗りさせた。
- `tags`/`article_tags`/`tag_suggestions`の3テーブル構成は、絞り込み述語ビルダー方式・既存のAI補助テーブル設計（要約/スコア分離）双方の慣習と整合させた。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| AIにタグを自由生成させ、後から正規化・統合する | 表記ゆれの解消は継続的な運用コストであり、絞り込み軸としての信頼性を初手から損なう | N/A |
| タグ付与を専用の別バッチ・別コールにする | ADR-0021のコスト設計（スコアはN/8コール）を壊す。タイトル・要約はスコア付けと同じ入力で足りるため相乗りが自然 | タグ付与に専用の（スコアより多い）コンテキストが必要になった場合 |
| 手動タグとAIタグを別テーブルにする | 表示・絞り込みが両者の和集合であればよく、分離するとUNIONを要求し述語ビルダー方式と噛み合わない | N/A |
| 語彙が空でも`enum: []`を送る、またはenumを外して自由記述のtagsフィールドにする | 前者はstrict JSON Schemaとして不正で構造化出力が壊れる。後者は「AIに自由生成させない」という確定仕様に反する | N/A |
| 再計算を専用のバルクAPIエンドポイントとして新設する | ADR-0021の「profile_hash不一致=未処理」という既存メカニズムだけで十分に表現でき、新しい非同期ジョブ管理を増やすと状態管理が複雑化する | 明示的な即時一括再計算（日次バッチを待たない）が要件になった場合 |

## 結果

### 利点

- タグの表記ゆれが原理的に発生しない（AIは既存語彙からしか選べない）。
- AI補助のコール数が増えない（既存のスコア付けバッチにタグ付与が完全に相乗り）。
- タグ絞り込み・スニペット・スコア表示のいずれも、既存の述語ビルダー/`attachAiEnrichment`/keysetページネーションの拡張として実装でき、作り直しが発生していない。

### 欠点とリスク

- タグ語彙が空のオーナーは、AIタグ付与を一切受けられない（意図的な仕様だが、オンボーディング時に語彙が空である期間は「AIがタグを付けない」体験になる）。
- `article_tags.confidence`はAI付与について固定値`1`であり、将来「確信度でソート/フィルタしたい」という要求には現状のスキーマでは応えられない（列は残してあるため、スコアラー側の変更のみで拡張可能）。
- 「N件のスコアを再計算しますか」の確認ダイアログは、実際の処理タイミング（日次バッチの次回tick、またはオンデマンド`POST /enrich`）を保証しない。保存直後に即座に再計算されるわけではない。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | N/A — 本ADRが設計判断そのもの | Done | 本ファイル |
| ドメイン/ユースケース | `ArticleRelevanceScorer.score()`に`tagVocabulary`入力・`tags`/`suggestedTags`出力を追加 | Done | `packages/application/src/ports.ts` |
| OpenAPI/外部契約 | `Article.tags`、`Tag`/`TagSuggestion`スキーマ、`GET/POST/DELETE /v1/me/tags`、`PUT /v1/me/articles/{id}/tags`、`GET /v1/me/tag-suggestions`、`POST /v1/me/tag-suggestions/promote`、`GET /v1/me/articles`と`/facets`の`tagIds`、`ArticleFacets.aiPending` | Done | `packages/contracts/openapi/openapi.json`、`pnpm contract:generate`/`contract:lint`済み |
| コード/ポート | `LocalStore`のタグCRUD/絞り込み/AI付与メソッド、`OpenAiRelevanceScorer`のタグ相乗り、`AiEnrichWorker.scoreBatch`のタグ保存 | Done | `packages/adapters/src/db/local-store.ts`、`packages/adapters/src/ai-enrich/*.ts` |
| データ/ストレージ | `tags`/`article_tags`/`tag_suggestions`テーブル | Done | `packages/adapters/migrations/0012_article_tags.sql` |
| 実行/配備 | 追加のワーカー/環境変数なし（既存の`AiEnrichWorker`にそのまま乗る） | Done | N/A |
| 認証/セキュリティ | タグ・提案とも`owner_id`スコープの複合PK/述語で他owner不可視 | Done | `packages/adapters/src/db/local-store-tags.test.ts`、`apps/api/src/tags.test.ts` |
| フロント/品質保証 | `/articles`のタグチップ・絞り込み・スニペット・おすすめ順スコア表示・AI処理待ち表示、`/settings`の興味プロフィール編集・タグ語彙管理 | Done | `apps/web/src/routes/_authenticated/articles/`、`apps/web/src/routes/_authenticated/settings/` |
| テスト/運用 | 語彙外タグの提案振り分け、語彙が空の時のスキップ、タグ絞り込み+ページネーション併用、タグAPIのowner isolation、おすすめ順でスコア無し末尾、スニペットのフォールバック、提案からタグを作る導線 | Done | 下記検証証拠 |

## 再検討条件

- タグの確信度によるソート/フィルタが要件になった場合、`article_tags.confidence`にAIの実際の確信度を持たせる（スコアラーの出力スキーマ変更が必要）。
- 語彙が空の新規オーナーへのオンボーディング体験（初期タグ語彙の提案など）が問題になった場合、デフォルト語彙のシードを検討する。
- 「N件のスコアを再計算しますか」の確認が、実際の再計算完了を待たない設計であることがユーザー体験上の問題になった場合、進捗表示や即時トリガーAPIを別途検討する。

## 受け入れゲートと未決事項

- None

## 検証証拠

- `cd packages/adapters && npx vitest run`（122 tests, 全パス。新規: `db/local-store-tags.test.ts`、既存`ai-enrich/*.test.ts`へのタグ相乗りテスト追加）
- `cd apps/api && npx vitest run`（34 tests, 全パス。新規`src/tags.test.ts`5 tests）
- `cd apps/worker && npx vitest run`（13 tests, 全パス。既存テストのみ——`AiEnrichWorker`本体側で契約テスト済み）
- `cd apps/web && npx vitest run`（107 tests, 全パス。新規: `-hooks/use-interest-profile-form.test.ts`、`-hooks/use-tag-vocabulary.test.ts`、既存`-model.test.ts`/`use-article-list.test.ts`へのタグ/おすすめ順テスト追加）
- `npx oxlint apps packages`（クリーン）、`cd apps/web && npx oxfmt --check`（クリーン）
- `cd apps/web && npx vite build`・`npx storybook build`（いずれも成功）
- `pnpm contract:generate && pnpm contract:lint`（`No results with a severity of 'error' found!`）
- LLM呼び出しは実通信を行わず、`vi.fn<typeof fetch>()`によるfakeレスポンスでenumによる語彙制約・語彙外フィルタ・語彙空時のフィールド省略を検証（`docs/design.md`§7準拠）。
