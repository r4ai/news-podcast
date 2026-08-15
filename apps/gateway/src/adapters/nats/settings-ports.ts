import { parse } from "@news-podcast/kernel"
import {
  parseContentPersonalizationReply,
  parseIdentitySettingsReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect } from "effect"

import { UserSettingsSchema } from "../../contract.js"
import type { GatewayPorts } from "../../ports.js"
import { normalizeProblem, unavailable } from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * 生成スケジュール（identity-access）と興味プロフィール（content-knowledge）を、
 * ひとつの設定ビューへ合成する。片方でも欠ければ設定は返さない。
 */

type SettingsPorts = Pick<GatewayPorts, "getSettings" | "updateSettings">
type Headers = Parameters<GatewayPorts["getSettings"]>[0]
type IdentityReply = Effect.Success<
  ReturnType<typeof parseIdentitySettingsReply>
>
type ContentReply = Effect.Success<
  ReturnType<typeof parseContentPersonalizationReply>
>

export const makeSettingsPorts = (transport: Transport): SettingsPorts => {
  const identityRpc = (headers: Headers, subject: string, payload: unknown) =>
    transport.ownerRpc(
      headers,
      subject,
      "identity-access",
      payload,
      parseIdentitySettingsReply
    )

  const personalizationRpc = (headers: Headers, payload: unknown) =>
    transport.ownerRpc(
      headers,
      subjects.content.personalization,
      "content-knowledge",
      payload,
      parseContentPersonalizationReply
    )

  const combine = (
    parts: Effect.Effect<readonly [IdentityReply, ContentReply], unknown>
  ) =>
    parts.pipe(
      Effect.flatMap(([identity, content]) =>
        (identity._tag === "Settings" && content._tag === "InterestProfile"
          ? parse(UserSettingsSchema)({
              generationSchedule: identity.generationSchedule,
              interestProfile: content.interestProfile,
            })
          : Effect.fail(unavailable())
        ).pipe(Effect.mapError(normalizeProblem))
      ),
      Effect.mapError(normalizeProblem)
    )

  const readSchedule = (headers: Headers) =>
    identityRpc(headers, subjects.identity.getGenerationSettings, {
      operation: "Get",
    })

  const readInterestProfile = (headers: Headers) =>
    personalizationRpc(headers, { operation: "GetInterestProfile" })

  return {
    getSettings: (headers) =>
      combine(
        Effect.all([readSchedule(headers), readInterestProfile(headers)])
      ),
    // 未指定の側は更新せず現在値を読み直すことで、部分更新でも全体像を返す。
    updateSettings: ({ headers, payload }) =>
      combine(
        Effect.all([
          payload.generationSchedule === undefined
            ? readSchedule(headers)
            : identityRpc(headers, subjects.identity.updateGenerationSettings, {
                operation: "Update",
                generationSchedule: payload.generationSchedule,
              }),
          payload.interestProfile === undefined
            ? readInterestProfile(headers)
            : personalizationRpc(headers, {
                operation: "UpdateInterestProfile",
                interestProfile: payload.interestProfile,
              }),
        ])
      ),
  }
}
