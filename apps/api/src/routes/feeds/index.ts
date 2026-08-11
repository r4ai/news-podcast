import type { RouteRegistrar } from "../../http/context.js"
import { registerListFeeds } from "./list.js"
import { registerRegisterFeed } from "./register-feed.js"

export const feedsRegistrars: readonly RouteRegistrar[] = [
  registerListFeeds,
  registerRegisterFeed,
]
