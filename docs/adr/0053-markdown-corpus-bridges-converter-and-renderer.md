# ADR-0053: 変換器の実出力をgolden corpusとして描画側へ橋渡しする

- Status: Accepted
- Date: 2026-08-15
- Decision owners: rai
- Supersedes: N/A
- Superseded by: N/A
- Related: [ADR-0051](0051-extensible-article-markdown-conversion.md)、[ADR-0042](0042-structured-input-parser-boundaries.md)、[design.md](../design.md) §7.1 / §8

## コンテキストと変更契機

確認済みの事実:

- 記事本文が`{"markdown":"…\n\n…"}`という**JSONのソース文字列そのもの**として画面に描画されていた。Gatewayは`application/json`で`{ markdown }`を返す（`apps/gateway/src/contract.ts`の`getArticleMarkdownEndpoint`）が、Web側は`parseAs: "text"`で本文を取っていた。
- どのテスト層もこれを検知できなかった。e2eと視覚回帰が使う偽Gateway（`apps/web/scripts/run-fake-stack.ts`）が`text/markdown`で生本文を返しており、**実契約ではなくWeb側のバグに一致していた**。単体テストのstubも同じ形を写していた。
- 描画側（`apps/web/src/shared/markdown/`）は、Content Knowledgeの変換器が実際に出力したMarkdownに対して**一度も実行されたことがなかった**。`markdown.stories.tsx`のfixtureは方言を手で近似したもの。
- その結果、実データでしか現れない欠陥が残っていた。リンクカードのfaviconのような文中の小さな画像が図版として中央寄せ・枠付きになる、`alt`（実記事では図を説明した長文）が全てキャプションとして本文に二重表示される、など。

制約:

- `apps/web`は`services/**`をimportできない（依存境界、`pnpm architecture:check`）。
- 変換器の入力fixtureは`services/content-knowledge/fixtures/article-markdown/`にあり、`manifest.json`がsha256で来歴を固定している（ADR-0051）。

## 決定

1. **テストダブルは実装ではなく契約に従う。** 偽Gatewayの応答は`packages/contracts/openapi/openapi.json`に一致させ、`apps/web/scripts/fake-api.contract.test.ts`がそれを検査する。ハンドラは`run-fake-stack.ts`（起動）から`fake-api.ts`（応答）へ分け、テストから直接叩けるようにする。
2. **変換器の実出力をgolden corpusとして描画側へ渡す。** repo rootの`scripts/generate-markdown-corpus.mts`がfixtureを変換し、`apps/web/src/shared/markdown/__fixtures__/*.md`と`corpus.json`をcommitする。橋渡しは「生成物のcommit」で行い、パッケージ間のimportは作らない。CIは`pnpm markdown:corpus:check`でdriftを検出する。
3. **corpusは実際のパイプラインで描画して検証する。** `corpus.test.tsx`が各fixtureを`<Markdown>`で描画し、方言の生漏れが無いこと・見出しが飛ばないこと・URLが絶対であること、そして**Reactコンポーネントを持たずに描画された要素の一覧**が宣言済みの集合と厳密に一致することを検査する。見た目そのものはStorybookの`Markdown/Corpus`で確認する。

## 判断要因

- 契約不整合は「どちらか一方を直す」問題ではなく「両者を1つの証拠で縛る」問題である。テストダブルが実装に合わせて漂流すると、テストの枚数に関わらず検知能力がゼロになる。
- 未mapタグの一覧を厳密一致で固定すると、「実データが何を使っているか」が失敗メッセージとして出る。欠けている要素を人が推測して列挙する必要がなくなる。
- fixtureは最小化済みのHTMLなので、corpusをcommitしても数KBに収まりレビューでdiffが読める。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| `apps/web`から変換器を直接importしてテスト時に変換する | 依存境界（`architecture:check`）を破る。webのバンドルにjsdomとReadabilityが載る危険もある | 依存境界の方針自体が変わったとき |
| corpusを生成せず、手書きfixtureを増やす | 手書きは「変換器が実際に出すもの」ではない。今回の欠陥（長い`alt`、faviconの入れ子リンク）はどれも人が思い付かなかった形だった | 変換器の出力が凍結され、方言が増えなくなったとき |
| Gateway側を`text/markdown`に変えてWebへ合わせる | 本文はOpenAPIで`{ markdown }`として公開済みで、他の消費者との互換を壊す。誤っていたのは受け側 | N/A |
| 偽Gatewayを廃止し、e2eを実スタックへ向ける | 起動時間と外部プロバイダ依存が視覚回帰の実行コストを跳ね上げる | 実スタックの起動が十数秒で安定するようになったとき |

## 結果

### 利点

- 保存Markdownの方言変更が、描画側の回帰として自動的に現れる。
- 偽Gatewayの応答形が実契約から漂流できなくなる。
- 視覚回帰の本文が方言を一通り含むようになり、Markdownコンポーネントの変更がスナップショットに現れるようになった（従来は段落と箇条書きだけで、変更しても差が出なかった）。

### 欠点とリスク

- 生成物をcommitするため、変換器を変えたときに`pnpm markdown:corpus`の実行を忘れるとCIが落ちる（意図した挙動だが、手順を知らないと迷う）。
- corpus描画テストはShikiの言語遅延importとKaTeXを通るため、純関数テストより重い。100%カバレッジゲートには含めない。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | §7.1に要素マップ・見出しアンカー・目次、§8にcorpus検証を追記 | Done | `docs/design.md` |
| ドメイン/ユースケース | N/A — 表示と検証の話で、ドメイン規則は変わらない | Done | N/A |
| OpenAPI/外部契約 | N/A — 契約は元から正しく、合わせたのは受け側 | Done | `packages/contracts/openapi/openapi.json` |
| コード/ポート | 本文取得を`{ markdown }`として読む。偽Gatewayを分離 | Done | `apps/web/src/routes/_authenticated/articles/-queries.ts`、`apps/web/scripts/fake-api.ts` |
| データ/ストレージ | N/A — 保存形式は変えない | Done | N/A |
| 実行/配備 | `pnpm markdown:corpus` / `:check`を追加、CIの`static` jobで検査 | Done | `package.json`、`.github/workflows/ci.yml` |
| 認証/セキュリティ | 画像に`referrerPolicy="no-referrer"`。取得元は第三者サイト | Done | `apps/web/src/shared/markdown/components/image.tsx` |
| フロント/品質保証 | corpus描画テストとStorybook story、視覚回帰の本文拡充 | Done | `apps/web/src/shared/markdown/corpus.test.tsx`、`markdown-corpus.stories.tsx` |
| テスト/運用 | `pnpm markdown:corpus:check`、`pnpm --filter web test`、`pnpm --filter web test:visual` | Done | 下記「検証証拠」 |

## 再検討条件

- 変換器のfixtureが最小化HTMLではなく実記事の完全なHTMLになり、corpusのcommitサイズがレビュー可能な範囲を超えたとき。
- `apps/web`と`services/content-knowledge`が同一パッケージへ統合され、生成物を介さず直接検証できるようになったとき。

## 受け入れゲートと未決事項

- 既存アーカイブは古い変換器で保存されており、ページのナビゲーションが本文へ混入しているものがある。現行の変換器では再現しないため、再アーカイブで解消する。再アーカイブの実施可否は未決。

## 検証証拠

- `pnpm markdown:corpus:check` — corpusがfixtureと同期していること
- `pnpm --filter web test` — corpus描画の不変条件と偽Gatewayの契約適合
- `pnpm --filter web test:markdown:coverage` — 追加した純関数（`lib/slug.ts`、`lib/to-plain-text.ts`）が100%
- `pnpm --filter @news-podcast/content-knowledge test:article-markdown:coverage` — 変換器側100%を維持
- `pnpm --filter web test:visual` — 方言を含む本文でスナップショットとaxeが通ること
- `pnpm lint`（`architecture:check` / `parser:check`を含む）
