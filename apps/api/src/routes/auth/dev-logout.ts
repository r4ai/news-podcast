import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"

/** POST /api/dev/logout — 開発専用ログアウト。未配線環境では503。 */
export const registerDevLogout: RouteRegistrar = (app, dependencies) =>
  app.post("/api/dev/logout", (context) =>
    dependencies.devLogoutHandler
      ? dependencies.devLogoutHandler(context.req.raw)
      : unavailable(context)
  )
