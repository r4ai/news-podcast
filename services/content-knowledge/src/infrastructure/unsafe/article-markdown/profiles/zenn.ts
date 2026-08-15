import type { SiteProfile } from "../core/contracts.js"

export const zennProfile: SiteProfile = Object.freeze({
  id: "zenn",
  hosts: ["zenn.dev"],
  articleRoot: ".znc",
  remove: [".footnotes-sep"],
  filenameSelectors: [".code-block-filename"],
  callouts: [
    { selector: "aside.msg.alert", type: "warning" },
    { selector: "aside.msg.message", type: "note" },
    { selector: "aside.msg", type: "note" },
  ],
})
