import type { SiteProfile } from "../core/contracts.js"

export const zennProfile: SiteProfile = Object.freeze<SiteProfile>({
  id: "zenn",
  hosts: ["zenn.dev"],
  articleRoot: ".znc",
  remove: [".footnotes-sep", ".msg-symbol", ".header-anchor-link"],
  filenameSelectors: [".code-block-filename"],
  encodedEmbeds: [
    { selector: ".zenn-embedded-card", kind: "card" },
    { selector: ".zenn-embedded-github", kind: "embed" },
    { selector: ".zenn-embedded-mermaid", kind: "mermaid" },
  ],
  mathSources: [
    { selector: 'embed-katex[display-mode="1"]', display: true },
    { selector: 'embed-katex:not([display-mode="1"])', display: false },
  ],
  callouts: [
    { selector: "aside.msg.alert", type: "warning" },
    { selector: "aside.msg.message", type: "note" },
    { selector: "aside.msg", type: "note" },
  ],
})
