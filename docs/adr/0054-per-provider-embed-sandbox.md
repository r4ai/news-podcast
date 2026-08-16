# ADR-0054: 埋め込みのsandbox権限をprovider単位で宣言する

- Status: Accepted
- Date: 2026-08-16
- Decision owners: rai
- Supersedes: N/A
- Superseded by: N/A
- Related: [ADR-0051](0051-extensible-article-markdown-conversion.md)（外部embedの自動ロード方針を部分改訂）、[ADR-0053](0053-markdown-corpus-bridges-converter-and-renderer.md)、[design.md](../design.md) §8

## コンテキストと変更契機

ADR-0051は外部embedを「HTTPS provider allowlist、空sandbox、`no-referrer`」で自動ロードすると定めた。`sandbox=""`は全ての権限を落とすため、iframeの中でJavaScriptが動かない。

corpusを実ブラウザで描画して初めて、この帰結が見えた。**YouTube埋め込みは動画によらず必ず黒いエラーパネルになる**（「エラーが発生しました。JavaScript を実行できませんでした。」）。allowlistに挙げてあるのは動画プレイヤー・スライド・コードエディタばかりで、いずれもJavaScriptなしでは何も描画できない。つまり自動ロードの仕組みは存在するが、実際には1件も機能していなかった。

sandboxだけを変えた対照実験（同一の埋め込みURL、同一ブラウザ）:

| sandbox | プレイヤー初期化 |
| --- | --- |
| 指定なし | する |
| `""` | **しない** |
| `allow-scripts` | する |
| `allow-scripts allow-same-origin` | する |

`allow-scripts`だけで、sandbox無しと同じところまで初期化する。`localStorage`はopaque originのため遮断されるが、providerはそれを許容している。

## 決定

sandbox権限を**provider単位のプロパティ**として`lib/embed.ts`のallowlistへ持たせ、`Embed`はその値をそのまま`<iframe sandbox>`へ渡す。

- 既定は「何も与えない」。providerごとに必要な権限だけを列挙する。現在はどのproviderも`allow-scripts`だけ。
- **`allow-same-origin`は与えない。** 権限を表す型のunionから外し、書こうとしても型検査で通らないようにする。`allow-scripts`と揃うとiframeが自分のsandbox属性を書き換えて制限を全て外せるため、「レビューで気を付ける」ではなく表現不能にする。
- `allow-top-navigation`・`allow-downloads`・`allow-popups`・`allow-forms`も現時点ではどのproviderにも与えない。
- allowlistに載らないhostnameの扱いは変えない。URLがどれだけ安全に見えてもiframeにせず、リンクへ落とす。
- `referrerPolicy="no-referrer"`は維持する。どの記事を読んでいるかをprovider側へ知らせない。

## 判断要因

- 危険な組み合わせは1つ（`allow-scripts` + `allow-same-origin`）に集約されており、型で排除できる。
- 権限をproviderごとに書くと、新しいproviderを足す人が「このproviderは何を要るのか」を必ず1度考えることになる。全体に効く既定値を緩めるより、影響範囲が読める。
- 実際に守っているのは第一にallowlistであって、sandboxは二重の防御。allowlistを緩めていない以上、到達できるオリジンの集合は変わらない。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| `sandbox=""`のまま維持する | 埋め込みが1件も機能しない。動かない機能をUIに出し続けるより、外すか動かすかのどちらかにすべき | providerが軒並みJS不要の静的表現を提供するようになる |
| 全providerへ一律`allow-scripts allow-same-origin` | 必要が確認できていない権限を配る。実験では`allow-scripts`だけで足りた | 特定providerが`allow-same-origin`無しでは動かないと実測できたとき（その場合もそのproviderだけに限定する） |
| sandboxをやめて`<iframe>`を素で使う | top navigation、popup、download、modalまで開く。allowlistの外側の防御が消える | N/A |
| 自動ロードをやめ、サムネイル＋リンクカードへ落とす | 第三者への通信は減るが、記事本文の体験としては後退する。allowlistとsandboxで到達範囲は既に閉じている | 埋め込み由来のプライバシー問題が実際に観測されたとき |

## 結果

### 利点

- allowlistに載せたproviderの埋め込みが実際に表示される。
- 危険なsandboxの組み合わせがコンパイル時に排除される。
- 権限の増減がprovider単位のdiffとして現れ、レビューで追える。

### 欠点とリスク

- iframe内で第三者のJavaScriptが動く。opaque originなので親のDOM・Cookie・storageへは到達できないが、provider自身の計測は動く。
- `no-referrer`のままなので、埋め込み許可をリファラで判定するproviderでは表示に失敗する可能性がある。ヘッドレス環境では確認しきれておらず、実ブラウザでの追試が要る（下記「受け入れゲートと未決事項」）。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | §8のembed方針にprovider別sandboxを追記 | Done | `docs/design.md` |
| ドメイン/ユースケース | N/A — 表示側の方針 | Done | N/A |
| OpenAPI/外部契約 | N/A | Done | N/A |
| コード/ポート | allowlistへsandboxを持たせ、`Embed`が渡す | Done | `apps/web/src/shared/markdown/lib/embed.ts`、`components/embed.tsx` |
| データ/ストレージ | N/A — 保存Markdownは不変 | Done | N/A |
| 実行/配備 | N/A | Done | N/A |
| 認証/セキュリティ | `allow-same-origin`を型で排除。到達可能オリジンはallowlistのまま不変 | Done | `lib/embed.test.ts` |
| フロント/品質保証 | sandbox方針のテストとcorpus描画 | Done | `lib/embed.test.ts`、`markdown.test.tsx` |
| テスト/運用 | `pnpm --filter web test:markdown:coverage` | Done | 下記「検証証拠」 |

## 再検討条件

- providerが`allow-scripts`だけでは動かなくなり、追加権限を求めるようになったとき。
- 埋め込み経由の計測・トラッキングが問題として観測されたとき（自動ロードの是非へ戻る）。
- `no-referrer`のまま表示に失敗するproviderが実ブラウザで確認されたとき。

## 受け入れゲートと未決事項

- `referrerPolicy="no-referrer"`のまま実ブラウザでYouTube等が再生できるかは未確認。ヘッドレスChromiumは専有コーデックを持たず、この環境では判定できなかった。実ブラウザでの目視が必要。

## 検証証拠

- 対照実験: 同一埋め込みURLに対しsandboxだけを変え、`""`は`#movie_player`が生成されず、`allow-scripts`は指定なしと同じく生成されることを確認。
- `pnpm --filter web test` — sandboxにescape権限が含まれないこと、必要な`allow-scripts`が付くことをprovider全件で検査。
- `pnpm --filter web test:markdown:coverage` — `lib/embed.ts`は100%。
