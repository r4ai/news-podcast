import type { OpenAPIHono } from "@hono/zod-openapi"

import type { AppDependencies } from "../dependencies.js"

/** /v1 ミドルウェアが context.set() で書き込む値。 */
export type Variables = { ownerId: string }

/** createApp() が組み立てる Hono アプリの型。route モジュールはこれを受け取って登録する。 */
export type ApiApp = OpenAPIHono<{ Variables: Variables }>

/**
 * 1ルートの登録関数の型。`app.openapi(route, handler)` の呼び出しをラップし、
 * routes/<resource>/index.ts が配列として束ね、routes/index.ts が登録順を決める。
 */
export type RouteRegistrar = (
  app: ApiApp,
  dependencies: AppDependencies
) => void
