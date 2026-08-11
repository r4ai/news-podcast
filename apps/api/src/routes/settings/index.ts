// 生成スケジュールと興味プロファイル。
import type { RouteRegistrar } from "../../http/context.js"
import { registerGetSettings } from "./get.js"
import { registerPatchSettings } from "./patch.js"

export const settingsRegistrars: readonly RouteRegistrar[] = [
  registerGetSettings,
  registerPatchSettings,
]
