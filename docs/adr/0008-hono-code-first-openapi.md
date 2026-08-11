# ADR-0008: Hono code-first OpenAPIを契約の正本にする

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / API
- Supersedes: ADR-0002の「YAMLを契約の正本とする」部分
- Superseded by: N/A
- Related: `apps/api/src/routes/`, `apps/api/src/app.ts`, `packages/contracts/openapi/openapi.json`

## コンテキストと変更契機

手書きYAMLとHono handlerの二重管理では、実装・response・Web型の差異を品質ゲートまで検出できない。

## 決定

`@hono/zod-openapi` のrouteとZod schemaを正本にする。HonoからOpenAPI JSONを生成し、`openapi-typescript` の生成型だけをWebの `openapi-fetch` / `openapi-react-query` に渡す。生成差分は `pnpm contract:check` で失敗させる。

## 判断要因

- runtime validationと公開契約を同じ定義から作る。
- URL、params、body、responseの手書き型をWebから除く。
- NodeとCloudflareのHono routeを共有する。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| YAML正本を継続 | handlerとの二重管理になる | server実装を別言語へ移す |
| Hono RPC型だけを配布 | OpenAPI client・外部利用へ接続しにくい | 外部契約を公開しない |

## 結果

生成物 `openapi.json` と `openapi.ts` はチェックインする。code-first schema変更時は両方の再生成が必須になる。

## 検証証拠

- `pnpm contract:check`
- `pnpm typecheck`
