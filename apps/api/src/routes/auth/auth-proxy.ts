import type { RouteRegistrar } from "../../http/context.js"

/** GET/POST /api/auth/* — Better Auth への委譲。authHandler未配線時は登録自体を省く。 */
export const registerAuthProxy: RouteRegistrar = (app, dependencies) => {
  if (!dependencies.authHandler) return
  const authHandler = dependencies.authHandler
  app.on(["GET", "POST"], "/api/auth/*", (context) =>
    authHandler(context.req.raw)
  )
}
