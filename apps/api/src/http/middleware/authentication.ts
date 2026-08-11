import type { MiddlewareHandler } from "hono"

import type { Variables } from "../context.js"
import { problem, unavailable } from "../problem.js"

/**
 * /v1/* の所有者解決。認証に失敗すれば401、resolveOwner自体が例外を投げたら
 * 依存未構築とみなし503に縮退する。/v1/audio/* は署名トークン自体が認可を
 * 兼ねるため対象外。
 */
export function authenticationMiddleware(
  resolveOwner?: (request: Request) => Promise<string | null>
): MiddlewareHandler<{ Variables: Variables }> {
  return async (context, next) => {
    if (context.req.path.startsWith("/v1/audio/")) return next()
    let ownerId: string | null
    try {
      ownerId = resolveOwner ? await resolveOwner(context.req.raw) : null
    } catch {
      return unavailable(context)
    }
    if (!ownerId) {
      return context.json(problem(401, "unauthorized", "Unauthorized"), 401)
    }
    context.set("ownerId", ownerId)
    return next()
  }
}
