# コードメタデータ
- Source: https://example.com/articles/fts5
一般的なハイライターのクラス名を復元します。

```typescript title="src/example.ts"
const answer: number = 42
```

データ属性に保存された言語名と、近接するファイル名を使ってコードフェンスを組み立てます。

```js
console.log("hello")
```

highlight.jsやGitHub形式のクラス名も言語情報として解釈し、表示時のハイライトへ引き継ぎます。

```bash
pnpm test
```

コード本文は装飾用のspanを取り除いたプレーンテキストとして安全に保存します。
