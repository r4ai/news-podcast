import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect } from "effect"

import { SessionResponseSchema } from "../../contract.js"
import type { GatewayPorts } from "../../application/ports.js"
import { unavailable } from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * 稼働確認と、HTTPセッションから解決したアクターの公開ビュー。
 * 匿名でも200を返し、利用可能なログイン手段だけを伝える。
 */

type SessionPorts = Pick<GatewayPorts, "health" | "resolveSession">

export const makeSessionPorts = (transport: Transport): SessionPorts => ({
  health: () => Effect.succeed(deepFreeze({ status: "ok" as const })),
  resolveSession: (headers) =>
    transport.resolveActor(headers).pipe(
      Effect.map(({ actor }) =>
        actor._tag === "User"
          ? deepFreeze({
              authenticated: true as const,
              userId: actor.userId,
              loginMethods: transport.loginMethods,
            })
          : deepFreeze({
              authenticated: false as const,
              loginMethods: transport.loginMethods,
            })
      ),
      Effect.flatMap(parse(SessionResponseSchema)),
      Effect.mapError(unavailable)
    ),
})
