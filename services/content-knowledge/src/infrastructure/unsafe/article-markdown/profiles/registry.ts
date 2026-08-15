import type { SiteProfile } from "../core/contracts.js"
import { qiitaProfile } from "./qiita.js"
import { zennProfile } from "./zenn.js"

export const SITE_PROFILES: readonly SiteProfile[] = Object.freeze([
  zennProfile,
  qiitaProfile,
])

export const selectSiteProfile = (
  sourceUrl: URL,
  profiles: readonly SiteProfile[] = SITE_PROFILES
): SiteProfile | undefined => {
  const hostname = sourceUrl.hostname.toLowerCase()
  return profiles.find((profile) => profile.hosts.includes(hostname))
}
