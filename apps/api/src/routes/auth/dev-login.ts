import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"

/** POST /api/dev/login — 開発専用ログイン。未配線環境（本番等）では503。 */
export const registerDevLogin: RouteRegistrar = (app, dependencies) =>
  app.post("/api/dev/login", (context) =>
    dependencies.devLoginHandler
      ? dependencies.devLoginHandler(context.req.raw)
      : unavailable(context)
  )
