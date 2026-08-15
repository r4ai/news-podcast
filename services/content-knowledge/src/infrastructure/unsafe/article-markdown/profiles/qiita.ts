import type { SiteProfile } from "../core/contracts.js"

export const qiitaProfile: SiteProfile = Object.freeze({
  id: "qiita",
  hosts: ["qiita.com"],
  articleRoot: "#personal-public-article-body",
  remove: [".it-MdContent-footer"],
  filenameSelectors: [".code-lang"],
  callouts: [
    { selector: ".note.alert", type: "danger" },
    { selector: ".note.warn", type: "warning" },
    { selector: ".note.info", type: "info" },
  ],
})
