# ADR-0098: 手動生成の記事選択を対応済みの新着順に合わせる

- Status: Accepted
- Date: 2026-09-12
- Decision owners: Platform
- Supersedes: [ADR-0021](0021-ai-article-enrichment.md)（推薦順・スコアなし末尾）、[ADR-0022](0022-tag-vocabulary-and-ai-tagging.md)（記事一覧の推薦順・スコア表示）
- Superseded by: N/A
- Related: Issue #116、[ADR-0059](0059-latest-interest-profile-generation-plan.md)、[ADR-0082](0082-index-latest-article-markdown-for-search.md)、[design §5](../design.md#5-rest契約方針)

## Context and change trigger

旧ADRは推薦スコアによる記事一覧の順序を確定仕様としていたが、現行マイクロサービスのOpenAPI・Gateway・Content Knowledgeは`newest` / `oldest`のみを受理する。Webの記事一覧も未対応の`relevance`指定を`newest`へ戻す。一方、手動生成は`sort=newest`で候補を取得しながら「おすすめ順」「おすすめを一括選択」と案内していた。

Issue #116の誤案内を、現行APIに文言を合わせる代替案で解消する。旧決定をこの範囲で変更し、推薦順の提供を未対応として明示する。

## Decision

| 対象 | 現行の契約 |
| --- | --- |
| 記事一覧API | 新着順・古い順。推薦順とスコアなし末尾の規則は提供しない |
| 手動生成候補 | 初回・検索・追加ページとも新着順で取得し、アーカイブ済みだけ表示 |
| 新着の基準 | 公開日時、なければ発見日時。日時が同じ場合は記事IDで安定順序を決定 |
| 一括選択 | 「上から一括選択」。表示済みの先頭から最大20件を選ぶ |
| スコアがある/ない記事 | 順序へ影響しない。推薦順での一覧スコア表示も提供しない |

記事詳細が既存の補足スコアを表示する契約や、要約・タグ付与は対象外。自動生成で最新InterestProfileを使うADR-0059の選定と、手動指定記事を全件維持する契約も継続する。

## Decision drivers

- UIが実際の選択基準を説明し、関心度に基づく推薦と誤認させない。
- 対応していないsortを送信して候補取得を失敗させない。
- クライアントで読み込み済みページだけを再ソートすると、未取得ページを含む全体順序を保証できない。

## Rejected alternatives

| Alternative | Reason rejected | Reconsider when |
| --- | --- | --- |
| queryだけを`relevance`に変更 | 現行APIでは不正な値になる | API・永続化・ページングが対応した時 |
| ブラウザでスコア順にする | 未取得候補を評価できず、検索・追加ページで順位が変わる | 全候補を取得する別契約を採用する時 |
| 今回推薦機能を復旧する | owner別スコアの生成・保存・版管理まで必要で、誤案内修正より広い | 推薦順が明示的な商品要件として選択された時 |

## Consequences

表示と動作が一致する一方、古くて関心度の高い記事を優先する機能は提供しない。スコアがない記事も日時によって先頭になり得る。AI未処理を待つ必要はないが、本文アーカイブが完了するまでは候補から除外する。

## Impact and synchronization

| Surface | Change / evidence |
| --- | --- |
| Design / ADR | design §5、ADR-0021/0022の限定的な後続リンク |
| Frontend | dialog説明・一括選択ラベルを新着順に統一 |
| API / domain / storage | N/A — 現行の2種類のsort、日時順序、keysetを維持 |
| Runtime / deployment / security | N/A — 境界・認可・配備を変更しない |
| Tests / operations | スコア有無・ページ追加・検索のhook結合テスト、表示順20件のPC/390px E2E、既存画面のVRT・アクセシビリティ |

## Reconsideration conditions

推薦順を復旧する際は、owner別スコア生成・保存・プロフィール/プロンプト版の扱い・未処理末尾・安定したkeysetを一緒に設計し、OpenAPIと後続ADRを更新する。全ページの高/低/未処理記事で順序とowner isolationを検証してから「おすすめ順」を再公開する。

## Acceptance gates and open questions

None — Issue #116の現行順序へ表示を合わせる修正範囲。推薦機能の復旧は今回の決定に含めない。

## Validation evidence

- 文言の再現テストRed→Green、ホーム85 tests、対象行coverage 92.81%。
- PC/390pxで追加ページ・検索・先頭20件の生成要求を検証。各ブラウザのfake API状態を分離する。
- Web typecheck・lint・format・OpenAPI contract check、公式Playwrightコンテナの画面回帰4件が成功。
