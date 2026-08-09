import { DatabaseSync } from "node:sqlite"

import { betterAuth } from "better-auth/minimal"

import type { LocalAuthConfig } from "../config.js"

export function createLocalAuth(config: LocalAuthConfig) {
  return betterAuth({
    appName: "RSS News Podcast",
    secret: config.secret,
    baseURL: config.baseUrl,
    database: new DatabaseSync(config.databasePath),
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
  })
}
