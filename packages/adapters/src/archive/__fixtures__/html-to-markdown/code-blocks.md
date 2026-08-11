# コードブロックの変換
- Source: https://example.com/articles/fts5
仮想テーブルの定義はこうなります。実際に動かして索引サイズを測ってください。

```sql
CREATE VIRTUAL TABLE feed_items_fts USING fts5(
  title, summary, body,
  tokenize = 'trigram'
);
```

ハイライタが入っているとトークンが span に分割されます。この形でも言語が拾えるかを確認したい。

```ts
const rows = db.prepare(sql).all()
```

言語クラスの無いブロックもあります。

```
pnpm vitest run
```
