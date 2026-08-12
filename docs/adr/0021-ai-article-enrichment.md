# ADR-0021: RSS記事へのAI補助（要約・適合度スコア）の日次バッチ処理

- Status: Accepted
- Date: 2026-08-11
- Decision owners: Platform
- Supersedes: N/A
- Superseded by: 一部（「プロフィール変更時の再計算方針」）はADR-0024、一部（`temperature: 0`）はADR-0026、一部（要約形式とMermaid検証）はADR-0027
- Related: `docs/design.md`§7（LLM呼び出しはfake providerで契約テスト）、ADR-0016（`job_outbox`/リース機構と同様の「ワーカーがtickで進める」設計）、ADR-0019（keysetページネーション）、ADR-0020（FTS5全文検索・述語ビルダー方式）、ADR-0031（LLM応答の完全性・retry分類）

## コンテキストと変更契機

製品方針は「AIで情報を見やすくする」であり、単なるRSSリーダーに留まらない。確定済み仕様は以下の通り（ユーザーと合意済み、変更しない）:

- 興味の源泉は明示的な興味プロフィール（`interestProfile.include`/`exclude`の自由記述）のみ。行動からの自動学習はしない。
- AI処理は新着のみ・日次バッチ・件数上限つき。全件処理もオンデマンド専用もしない。
- 成果物は3つ: 日本語Markdown要約（約300字） / 適合度スコア(0-100)と理由1行 / タグ自動付与（タグは別スコープとして本ADRでは要約・スコアのみ扱う）。
- 要約は常に日本語（英語記事も日本語で要約する）。形式とMermaid検証はADR-0027を正本とする。
- スコアは並べ替え軸の一つ。既定は新着順のまま。低スコアを隠したりはしない。

既存資産: `openai-summary-generator.ts`の`text.format = {type:"json_schema", strict:true}`パターン、`openai-podcast-agent.ts`の生fetch+zod検証+`providerOperation()`計装、`config.ts`の`readOpenAiConfig`、`local-store.ts`の述語ビルダー方式（`ARTICLE_SELECT`/`ARTICLE_FROM`/`articleSearchPredicate()`）、`apps/worker/src/process-rss-archive.ts`の「`runOnce()`が毎tick小さく進める」パターン。

コスト上の制約が最大の設計圧力になる。要約は記事本文（数千字のMarkdown）を読ませる必要があるため1記事1コールが避けられないが、スコアはタイトル・要約だけで足りるため複数記事をまとめられる。また日次バッチを回すと429（レート制限）を確実に踏むため、リトライ設計を最初から入れる必要がある。

## 決定

### データモデル（`packages/adapters/migrations/0011_ai_enrichment.sql`）

- `user_settings`に`interest_include`/`interest_exclude`/`interest_profile_hash`を追加。ハッシュは`sha256(include + " " + exclude)`（`computeProfileHash()`、`packages/adapters/src/ai-enrich/shared.ts`）で、**保存された値を信用せず常に本文から再計算する**。保存はデバッグ・監査目的であり、比較には常に再計算した値を使う。
- `article_summaries(snapshot_id PK, model, prompt_version, summary_json, tokens_in, tokens_out, created_at)` — **所有者非依存**。記事本文にのみ依存するスナップショット単位の要約で、同じ記事を購読する複数ownerがいても1回しか要約コールを払わない。
- `article_relevance(owner_id, feed_item_id, PK複合, profile_hash, model, prompt_version, score, reason, status, error, tokens_in, tokens_out, created_at)` — 所有者ごとに1行。`status IN ('succeeded','failed')`。`profile_hash`/`prompt_version`が現在値と一致し`status='succeeded'`の行だけが「処理済み」として扱われる。
- `ai_enrich_daily_progress(local_date PK, processed_count)` — 日次上限をtick・owner・プロセス再起動を跨いで遵守するためのカウンタ。

要約とスコアを別テーブルに分けたのは、**更新頻度と依存関係が異なる**ため。要約は記事が変わらない限り不変（所有者に依存しない）。スコアは興味プロフィールが変わるたびに全記事分が陳腐化しうる。同じテーブルに同居させると、プロフィール変更のたびに要約まで無駄に再生成してしまう。

### プロンプトのバージョニング

`SUMMARY_PROMPT_VERSION` / `RELEVANCE_PROMPT_VERSION`（`shared.ts`）を文言の版とする。候補選定クエリ（`LocalStore.listEnrichCandidates`/`attachAiEnrichment`）は**この定数と一致する行だけ**を「処理済み」とみなす。プロンプト文言を変えて定数を上げれば、既存の全行が自動的に「未処理」へ戻り、次回バッチで再生成される。マイグレーションや一括UPDATEは不要。

### プロフィール変更時の再計算方針

> **2026-08-11改訂**: 本方針（プロフィール変更で全記事を自動再処理）は **ADR-0024** に置き換えられた。
> 以降は「1回処理済み=任意のprofile_hashでsucceeded」とし、プロフィール編集・タグ追加では自動再処理せず、
> 明示再処理（`POST /enrich/reprocess`・記事ごとの`POST /enrich`）のみで再計算する。旧行は表示に残す。

当初方針（履歴）: `article_relevance`の`profile_hash`列と、候補選定クエリのNOT EXISTS条件（`profile_hash = 現在のハッシュ`）により、**プロフィールを変更した瞬間に該当ownerの全記事のスコアが「未処理」扱いになる**。古いプロフィールでのスコア行は削除せず残す（監査・障害調査用、および同じプロフィールに戻した場合の再利用は狙わない——ハッシュが変わった時点で厳密に再計算する方が「今のプロフィールに基づくスコア」という不変条件を保ちやすい）。要約は影響を受けない（所有者非依存のため）。

### 日次バッチのコスト設計（`apps/worker/src/node.ts`のtickから`AiEnrichWorker.runOnce()`）

対象は`archive_status='succeeded'`の新着のうち、現行`profile_hash`/`prompt_version`で未処理のものを新しい順に、環境変数`AI_ENRICH_DAILY_LIMIT`（既定200）で上限を切る。

- **要約は1記事1コール**。本文Markdownをオブジェクトストアから取得し、先頭`SUMMARY_MAX_MARKDOWN_CHARS`（6,000字）へ切り詰めてから送る。既に現行`prompt_version`の要約があれば再利用し、コールしない。
- **スコアは`RELEVANCE_BATCH_SIZE`（8件、5〜10件の範囲）でまとめて1コール**。タイトルと要約のMarkdownだけを渡す。ここがコストの主眼——記事数が増えてもコール数は`N/8`で増える。プロンプトに明示的なスコア基準（include直合致80-100 / 部分関連50-79 / 中立30-49 / 無関係・exclude合致0-29）を持たせる。`temperature: 0`の指定はモデル非互換のためADR-0026で廃止された。
- 1ownerあたり1tickで処理する候補数を`RELEVANCE_BATCH_SIZE`に揃えることで、1tickの作業が高々1バッチ分に収まり、特定ownerが日次上限を独占しない。複数ownerがいる環境では、tickごとに全owner分の候補が少しずつ進む。
- トークン使用量（Responses APIの`usage.input_tokens`/`output_tokens`）を要約は`article_summaries`に、スコアはバッチ内で均等割り（端数は最後の記事へ寄せる）した上で`article_relevance`の各行に記録する。同時にOTelカウンタ`article.enrich.tokens`（属性`enrich.step`/`token.kind`）へも計上する。バッチの合算値を素朴に均等割りする設計であり、記事ごとの正確な内訳ではないが、コスト監視には十分な近似とする。

### 429/Retry-Afterハンドリング（`packages/adapters/src/ai-enrich/shared.ts`の`fetchWithRetry`）

Responses APIへの全リクエストを`fetchWithRetry()`でラップし、`429`応答を受けたら`Retry-After`ヘッダ（秒数またはHTTP日付）に従って待機し、最大`maxAttempts`回（既定3回）まで再試行する。ヘッダが無ければ既定5秒、上限60秒でキャップする。リトライを使い切っても429のままなら`ProviderRateLimitError`を投げ、呼び出し側（`AiEnrichWorker`）はそのバッチを`status='failed'`として記録し、次回tick（または次回オンデマンド呼び出し）で再試行対象に戻す。日次バッチ全体を止めず、他の候補・他ownerの処理は継続する。

### 要約とスコアの分離が既存の記事一覧・検索と統合される仕組み

`LocalStore.listArticles`/`getArticle`は`attachAiEnrichment()`で応答に`aiSummary`/`relevanceScore`/`relevanceReason`を後付けする（`article_summaries`/`article_relevance`をIN句で2次クエリ）。`sort=relevance`指定時だけ`article_relevance`をLEFT JOINしてORDER BYに使う。**未処理（スコア無し）記事は`CASE WHEN rel.score IS NULL THEN '1' ELSE '0' END`を先頭ソートキーにして常に末尾へ回し**、既存のkeysetページネーションと矛盾しないよう、この合成列も含めてカーソルへエンコードする（数値列はSQLiteの値クラス比較の落とし穴を避けるため固定長ゼロ埋めTEXTにしてから比較する）。`minScore`は未処理記事を満たさない扱いとして除外する。

### API

- `Article`に`aiSummary?: string`（Markdown要約）/`relevanceScore?: number`(0-100)/`relevanceReason?: string`を追加。
- `GET /v1/me/articles`に`sort=relevance`と`minScore`を追加。
- `POST /v1/me/articles/{id}/enrich`でオンデマンド再計算（日次上限の対象外——利用者の明示的な単発要求のため）。アーカイブ未完了なら409。
- `GET`/`PATCH /v1/me/settings`に`interestProfile`を追加（`generationSchedule`と同居、両方省略可能な部分更新）。

### レイヤー分離

`packages/adapters`は`@news-podcast/observability`に依存しない既存方針（`LocalStore`/`ArticleArchiver`と同じ）を踏襲する。`AiEnrichWorker`（`packages/adapters/src/ai-enrich/enrich-worker.ts`）はテレメトリを直接発行せず、`AiEnrichEvent`の判別共用体をコンストラクタの`onEvent`コールバックへ通知するだけにした。`apps/worker/src/node.ts`と`apps/api/src/node.ts`はそれぞれ自分のObservabilityインスタンスへこのイベントを写像する。これにより同じエンジンを「日次バッチ（worker）」と「オンデマンド再計算（api）」の両方から再利用でき、テストもObservability契約に依存せず書ける。

## 判断要因

- コストの9割は「本文を読ませるか」で決まる。要約だけ1記事1コールを許容し、スコアは徹底的にバッチ化する。
- 日次上限は「新着のみ・バッチ・上限つき」という確定仕様の直接の実装であり、無制限処理や常時オンデマンドを禁じる。
- プロンプト版とプロフィールハッシュによる「未処理」判定は、明示的な再計算トリガー（マイグレーション、フラグ立て直しバッチ等）を一切不要にする——候補選定クエリの条件だけで完結する。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| 要約とスコアを同一テーブルの列にする | プロフィール変更のたびに要約まで無駄に再生成対象になる、または複雑な部分更新ロジックが要る | N/A |
| プロフィール変更検知にトリガー/一括UPDATEを使う | 候補選定クエリの条件だけで「未処理」を表現できるため不要な複雑化。書き込みパスを増やすとバグの温床になる | N/A |
| スコアを記事1件ずつ個別コールにする | コストが件数に比例して増える。日次上限を守っても実質的な処理可能件数が1/5〜1/10に落ちる | N/A |
| `packages/adapters`が`@news-podcast/observability`に直接依存する設計 | 既存方針（LocalStore/ArticleArchiverの前例）から逸脱し、adaptersパッケージの依存範囲が広がる。onEventコールバックで十分に要件を満たせる | adapters配下の複数箇所で同種の要望が繰り返し出る場合 |
| バッチのトークン使用量を先頭記事にまとめて記録する | 特定記事のコストだけが異常に見え、監視・課金按分を誤らせる。均等割りの方が実用上安全 | 記事単位の正確なトークン内訳がAPIから取得できるようになった場合 |

## 結果

### 利点

- スコアリングのコールがN/8に抑えられ、記事数が増えてもコストが線形に膨らみにくい。
- 要約の所有者非依存キャッシュにより、同じ記事を複数ownerが購読していても要約コストは1回で済む。
- プロンプト版・プロフィールハッシュの2軸だけで「何を再処理すべきか」が一意に決まり、状態管理が単純。
- 429時も他の候補・他ownerの処理を止めない（バッチ単位の失敗分離）。

### 欠点とリスク

- スコアのトークン使用量はバッチ内均等割りであり、記事ごとの正確な課金内訳ではない。
- 429で失敗したバッチは`status='failed'`のまま残り、次回tickで再試行されるまでの間はスコア無し扱いになる（隠されないが、おすすめ順の末尾に留まる）。継続的にレート制限が続くと日次上限の消化効率が下がる。
- 1ownerあたり1tickの処理上限を`RELEVANCE_BATCH_SIZE`に揃えたため、大量の新着owner・大量新着記事が同時に発生すると全owner分を捌き切るまで複数tickかかる（tickは1秒間隔のため実用上は数秒〜数十秒で収束する想定）。
- タグの自動付与は本ADRのスコープ外（要約・スコアのみ実装）。別タスクで追加する。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | N/A — 本ADRが設計判断そのもの | Done | 本ファイル |
| ドメイン/ユースケース | `ArticleSummarizer`/`ArticleRelevanceScorer`ポート追加 | Done | `packages/application/src/ports.ts` |
| OpenAPI/外部契約 | `Article.aiSummary/relevanceScore/relevanceReason`、`GET /v1/me/articles`の`sort=relevance`/`minScore`、`POST /v1/me/articles/{id}/enrich`、`UserSettings.interestProfile` | Done | `packages/contracts/openapi/openapi.json`、`pnpm contract:generate`/`contract:lint`済み |
| コード/ポート | `OpenAiArticleSummarizer`/`OpenAiRelevanceScorer`/`AiEnrichWorker`/`fetchWithRetry` | Done | `packages/adapters/src/ai-enrich/*.ts` |
| データ/ストレージ | `article_summaries`/`article_relevance`/`ai_enrich_daily_progress`テーブル、`user_settings`への列追加 | Done | `packages/adapters/migrations/0011_ai_enrichment.sql` |
| 実行/配備 | `apps/worker/src/node.ts`のtickへ`AiEnrichWorker.runOnce()`追加、`AI_ENRICH_DAILY_LIMIT`環境変数 | Done | `apps/worker/src/node.ts` |
| 認証/セキュリティ | owner scopeは既存の購読ベース述語（`sub.owner_id`）を継承。`article_relevance`は`(owner_id, feed_item_id)`複合PKで他owner不可視 | Done | `packages/adapters/src/db/local-store.ts` |
| フロント/品質保証 | N/A — 本タスクは`apps/web`を対象外とする | Pending | 別エージェント |
| テスト/運用 | スキーマ違反時の扱い、日次上限、profile_hash不一致/一致、prompt_version変更、5-10件バッチ、429/Retry-After、トークン計上、`sort=relevance`の末尾配置、owner isolation | Done | 下記検証証拠 |

## 再検討条件

- 429が継続的に発生し日次上限の消化効率が実運用で問題になった場合、リトライ回数・待機上限の見直し、またはバッチサイズの動的縮小を検討する。
- タグ自動付与を実装する際、要約・スコアと同じ`article_relevance`/`article_summaries`に同居させるか別テーブルにするかを別途判断する。
- 記事単位の正確なトークン按分が必要になった場合（課金精度の要求が上がった場合）、バッチAPIの応答形式変更や1件ずつのコールへの回帰を検討する。

## 受け入れゲートと未決事項

- None

## 検証証拠

- `cd packages/adapters && npx vitest run`（98 tests, 全パス。うちAI補助関連は新規4ファイル35 tests: `ai-enrich/shared.test.ts`, `ai-enrich/openai-article-summarizer.test.ts`, `ai-enrich/openai-relevance-scorer.test.ts`, `ai-enrich/enrich-worker.test.ts`, `db/local-store-ai-enrich.test.ts`）
- `cd apps/api && npx vitest run`（29 tests, 全パス。新規`src/ai-enrich.test.ts`6 tests）
- `cd apps/worker && npx vitest run`（13 tests, 全パス。既存テストのみ——ワーカーの日次バッチ本体は`packages/adapters/src/ai-enrich/enrich-worker.test.ts`側で契約テスト済み）
- `npx oxlint packages/adapters apps/api apps/worker`（クリーン。既存の`packages/adapters/src/archive/html-to-markdown.ts`の警告のみ残存し、本タスク対象外の既存作業に起因）
- `cd packages/adapters && npx tsc --noEmit` / `cd apps/api && npx tsc --noEmit` / `cd apps/worker && npx tsc --noEmit` / `cd packages/application && npx tsc --noEmit` / `cd packages/observability && npx tsc --noEmit`（すべてクリーン）
- `pnpm contract:generate && pnpm contract:lint`（`No results with a severity of 'error' found!`）
- LLM呼び出しは実通信を行わず、`vi.fn<typeof fetch>()`によるfakeレスポンスで構造化出力の成功/スキーマ違反/429を検証（`docs/design.md`§7準拠）。
