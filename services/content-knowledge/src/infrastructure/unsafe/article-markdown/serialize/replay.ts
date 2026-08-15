import { toHtml } from "hast-util-to-html"
import type { Root as HastRoot } from "hast"

export const createReplayHtml = (markdown: string): string => {
  const tree: HastRoot = {
    type: "root",
    children: [
      { type: "doctype" },
      {
        type: "element",
        tagName: "meta",
        properties: { charSet: "utf-8" },
        children: [],
      },
      {
        type: "element",
        tagName: "meta",
        properties: {
          httpEquiv: ["Content-Security-Policy"],
          content: "default-src 'none'; style-src 'unsafe-inline'",
        },
        children: [],
      },
      {
        type: "element",
        tagName: "title",
        properties: {},
        children: [{ type: "text", value: "Archived article" }],
      },
      {
        type: "element",
        tagName: "pre",
        properties: {},
        children: [{ type: "text", value: markdown }],
      },
    ],
  }
  return toHtml(tree)
}
