import type { Root as MdastRoot } from "mdast"

import { extractArticleRoot } from "../extract/article-root.js"
import { openArticleDom } from "../extract/dom.js"
import { selectSiteProfile } from "../profiles/registry.js"
import {
  normalizeHeadingDepths,
  resolveArticleUrls,
} from "../rules/document.js"
import { applyFeatureRules, createFeatureRules } from "../rules/registry.js"
import {
  parseArticleHtml,
  sanitizeArticleHast,
  stringifyMarkdown,
  toMarkdownTree,
} from "../serialize/markdown.js"
import { createReplayHtml } from "../serialize/replay.js"
import type { ArticleArchiveArtifacts } from "./contracts.js"
import {
  isCaptureFailure,
  MAXIMUM_ARTICLE_MARKDOWN_BYTES,
  MAXIMUM_ARTICLE_PARSER_INPUT_BYTES,
  parserFailure,
  validateAstTree,
  validateHtmlBudget,
  validateMarkdownTree,
} from "./limits.js"

const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

const decodeInput = (
  raw: Uint8Array | string
): Readonly<{
  readonly bytes: Uint8Array
  readonly html: string
}> => {
  const bytes = typeof raw === "string" ? encoder.encode(raw) : raw
  if (bytes.byteLength > MAXIMUM_ARTICLE_PARSER_INPUT_BYTES)
    throw parserFailure("ResourceLimit")
  try {
    return Object.freeze({ bytes, html: decoder.decode(bytes) })
  } catch {
    throw parserFailure("MalformedResponse")
  }
}

const appendSource = (tree: MdastRoot, sourceUrl: URL): void => {
  tree.children.push({
    type: "paragraph",
    children: [
      { type: "text", value: "Source: " },
      {
        type: "link",
        url: sourceUrl.href,
        children: [{ type: "text", value: sourceUrl.href }],
      },
    ],
  })
}

export const convertArticleHtml = async (
  raw: Uint8Array | string,
  source: URL | string
): Promise<ArticleArchiveArtifacts> => {
  const startedAt = performance.now()
  try {
    const sourceUrl = source instanceof URL ? source : new URL(source)
    const { bytes, html } = decodeInput(raw)
    validateHtmlBudget(html)
    const profile = selectSiteProfile(sourceUrl)
    const dom = openArticleDom(html, sourceUrl)
    let appliedRules: readonly string[]
    let articleHtml: string
    try {
      appliedRules = await applyFeatureRules(
        createFeatureRules(),
        { sourceUrl, profile },
        dom.document
      )
      articleHtml = extractArticleRoot(dom.document, profile).html
    } finally {
      dom.close()
    }

    const parsed = parseArticleHtml(articleHtml)
    validateAstTree(parsed)
    const sanitized = sanitizeArticleHast(parsed)
    resolveArticleUrls(sanitized, sourceUrl)
    const tree = toMarkdownTree(sanitized)
    validateMarkdownTree(tree)
    normalizeHeadingDepths(tree)
    appendSource(tree, sourceUrl)
    const markdownText = stringifyMarkdown(tree)
    const markdown = encoder.encode(markdownText)
    if (markdown.byteLength > MAXIMUM_ARTICLE_MARKDOWN_BYTES)
      throw parserFailure("ResourceLimit")
    const replay = encoder.encode(createReplayHtml(markdownText))
    return Object.freeze({
      markdown,
      replay,
      diagnostics: Object.freeze({
        profileId: profile?.id ?? "generic",
        appliedRules,
        inputBytes: bytes.byteLength,
        markdownBytes: markdown.byteLength,
        durationMilliseconds: Math.max(0, performance.now() - startedAt),
      }),
    })
  } catch (error) {
    if (isCaptureFailure(error)) throw error
    throw parserFailure("MalformedResponse")
  }
}
