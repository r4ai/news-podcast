// 所有者ごとのフィード購読（有効/一時停止・作成・削除）。
import type { RouteRegistrar } from "../../http/context.js"
import { registerCreateSubscription } from "./create.js"
import { registerDeleteSubscription } from "./delete.js"
import { registerListSubscriptions } from "./list.js"
import { registerPatchSubscription } from "./patch.js"

export const subscriptionsRegistrars: readonly RouteRegistrar[] = [
  registerListSubscriptions,
  registerCreateSubscription,
  registerPatchSubscription,
  registerDeleteSubscription,
]
