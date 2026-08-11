import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"

/** GET /api/auth/state — 認証状態と有効なログイン手段を返す（未認証でも200）。 */
export const registerAuthState: RouteRegistrar = (app, dependencies) =>
  app.get("/api/auth/state", async (context) => {
    context.header("Cache-Control", "private, no-store")
    try {
      const ownerId = dependencies.resolveOwner
        ? await dependencies.resolveOwner(context.req.raw)
        : null
      return context.json({
        authenticated: ownerId !== null,
        loginMethods: dependencies.loginMethods ?? {
          development: false,
          google: false,
        },
      })
    } catch {
      return unavailable(context)
    }
  })
