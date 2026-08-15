import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import type { Element, Root as HastRoot } from "hast"
import type { Blockquote, Root as MdastRoot } from "mdast"

import {
  extractArticleRoot,
  prependTitleIfMissing,
} from "../extract/article-root.js"
import {
  extractReadableArticle,
  normalizeReadableArticle,
} from "../extract/readability.js"
import { convertArticleHtml } from "./pipeline.js"
import {
  isCaptureFailure,
  MAXIMUM_ARTICLE_AST_DEPTH,
  MAXIMUM_ARTICLE_AST_NODES,
  parserFailure,
  validateAstTree,
  validateHtmlBudget,
  validateMarkdownTree,
} from "./limits.js"

const failure = (reason: string) => ({ _tag: "CaptureFailed", reason })

describe("parser failure contract", () => {
  it("creates frozen typed failures and recognizes only their shape", () => {
    const value = parserFailure("ResourceLimit")
    expect(value).toEqual(failure("ResourceLimit"))
    expect(Object.isFrozen(value)).toBe(true)
    expect(isCaptureFailure(value)).toBe(true)
    expect(isCaptureFailure(null)).toBe(false)
    expect(isCaptureFailure("CaptureFailed")).toBe(false)
    expect(isCaptureFailure({})).toBe(false)
    expect(isCaptureFailure({ _tag: "Other" })).toBe(false)
  })
})

describe("HTML structural budget state table", () => {
  it.each([
    "plain text",
    "<!-- ok --><p title='>'>x</p>",
    '<![CDATA[x]]><br><x:y data-a="1" />',
    "<p   >x</p>",
    "<!doctype html><?xml version='1.0'?><_x-1>x</_x-1>",
    "1 < 2 and 3 > 1",
    "</div>",
  ])("accepts bounded HTML states", (html) => {
    expect(() => validateHtmlBudget(html)).not.toThrow()
  })

  it.each(["<!--", "<![CDATA[x", "<!doctype", "<p title='x'", "<p"])(
    "rejects malformed terminal state %s",
    (html) => {
      expect(() => validateHtmlBudget(html)).toThrowError(
        expect.objectContaining(failure("MalformedResponse"))
      )
    }
  )

  it("rejects comment and CDATA node floods", () => {
    expect(() =>
      validateHtmlBudget("<!--x-->".repeat(MAXIMUM_ARTICLE_AST_NODES + 1))
    ).toThrowError(expect.objectContaining(failure("ResourceLimit")))
    expect(() =>
      validateHtmlBudget("<![CDATA[x]]>".repeat(MAXIMUM_ARTICLE_AST_NODES + 1))
    ).toThrowError(expect.objectContaining(failure("ResourceLimit")))
  })
})

describe("AST budgets", () => {
  it("accepts a shallow HAST and rejects node/depth overflow", () => {
    expect(() =>
      validateAstTree({
        type: "root",
        children: [{ type: "text", value: "x" }],
      })
    ).not.toThrow()
    const many = {
      type: "root",
      children: Array.from({ length: MAXIMUM_ARTICLE_AST_NODES }, () => ({
        type: "text",
        value: "x",
      })),
    } as HastRoot
    expect(() => validateAstTree(many)).toThrowError(
      expect.objectContaining(failure("ResourceLimit"))
    )
    let deep: Element = {
      type: "element",
      tagName: "div",
      properties: {},
      children: [],
    }
    for (let index = 0; index <= MAXIMUM_ARTICLE_AST_DEPTH; index += 1)
      deep = {
        type: "element",
        tagName: "div",
        properties: {},
        children: [deep],
      }
    expect(() =>
      validateAstTree({ type: "root", children: [deep] })
    ).toThrowError(expect.objectContaining(failure("ResourceLimit")))
  })

  it("distinguishes empty, text, and non-text Markdown content", () => {
    expect(() =>
      validateMarkdownTree({
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "x" }] },
        ],
      })
    ).not.toThrow()
    expect(() =>
      validateMarkdownTree({
        type: "root",
        children: [{ type: "thematicBreak" }],
      })
    ).not.toThrow()
    expect(() =>
      validateMarkdownTree({
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", value: " " }] },
        ],
      })
    ).toThrowError(expect.objectContaining(failure("MalformedResponse")))
    expect(() =>
      validateMarkdownTree({
        type: "root",
        children: [{ type: "blockquote", children: [] }],
      })
    ).toThrowError(expect.objectContaining(failure("MalformedResponse")))
    expect(() =>
      validateMarkdownTree({
        type: "root",
        children: [
          { type: "root" } as unknown as MdastRoot["children"][number],
        ],
      })
    ).toThrowError(expect.objectContaining(failure("MalformedResponse")))

    const many = {
      type: "root",
      children: Array.from({ length: MAXIMUM_ARTICLE_AST_NODES }, () => ({
        type: "thematicBreak",
      })),
    } as MdastRoot
    expect(() => validateMarkdownTree(many)).toThrowError(
      expect.objectContaining(failure("ResourceLimit"))
    )

    let deep: Blockquote = {
      type: "blockquote",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "x" }] },
      ],
    }
    for (let index = 0; index <= MAXIMUM_ARTICLE_AST_DEPTH; index += 1)
      deep = { type: "blockquote", children: [deep] }
    expect(() =>
      validateMarkdownTree({ type: "root", children: [deep] })
    ).toThrowError(expect.objectContaining(failure("ResourceLimit")))
  })
})

describe("base article extraction", () => {
  it("normalizes nullable Readability output", () => {
    expect(normalizeReadableArticle(null)).toBeUndefined()
    expect(
      normalizeReadableArticle({
        content: " ",
        title: "",
        byline: null,
      } as never)
    ).toBeUndefined()
    expect(
      normalizeReadableArticle({
        content: " body ",
        title: " Title ",
        byline: null,
      } as never)
    ).toEqual({ content: "body", title: "Title" })
    expect(
      normalizeReadableArticle({ content: "body", title: null } as never)
    ).toEqual({ content: "body", title: "" })
  })

  it("prepends only a non-empty title that is not already first", () => {
    const document = new JSDOM("").window.document
    expect(prependTitleIfMissing(document, "<p>body</p>", "")).toBe(
      "<p>body</p>"
    )
    expect(
      prependTitleIfMissing(document, "<h1>Same</h1><p>body</p>", "Same")
    ).toBe("<h1>Same</h1><p>body</p>")
    expect(prependTitleIfMissing(document, "<p>body</p>", "New")).toContain(
      "<h1>New</h1>"
    )
  })
  it("uses profile roots, removes configured nodes, and keeps a matching title", () => {
    const document = new JSDOM(
      '<article><h1>Title</h1><p>body</p><i class="remove">remove</i></article>'
    ).window.document
    const result = extractArticleRoot(document, {
      id: "zenn",
      hosts: [],
      articleRoot: "article",
      remove: [".remove"],
      filenameSelectors: [],
      callouts: [],
    })
    expect(result.usedProfileRoot).toBe(true)
    expect(result.html).toContain("Title")
    expect(result.html).not.toContain("remove")
  })

  it("falls back through Readability and finally main/body", () => {
    const readableDocument = new JSDOM(
      `<title>Document title</title><main><div><p>${"long body ".repeat(80)}</p></div></main>`,
      { url: "https://example.com" }
    ).window.document
    const readable = extractArticleRoot(readableDocument, {
      id: "zenn",
      hosts: [],
      articleRoot: ".missing",
      remove: [],
      filenameSelectors: [],
      callouts: [],
    })
    expect(readable.usedProfileRoot).toBe(false)
    expect(readable.html).toContain("Document title")

    const untitledDocument = new JSDOM(
      `<main><div><p>${"untitled body ".repeat(80)}</p></div></main>`,
      { url: "https://example.com" }
    ).window.document
    expect(extractArticleRoot(untitledDocument).html).toContain("untitled body")

    const multipleArticles = new JSDOM(
      `<main><article><p>${"first ".repeat(80)}</p></article><article><p>second</p></article></main>`,
      { url: "https://example.com" }
    ).window.document
    expect(extractArticleRoot(multipleArticles).usedProfileRoot).toBe(false)

    const mainDocument = new JSDOM("<main><p>short</p></main>").window.document
    expect(extractArticleRoot(mainDocument).html).toContain("short")
    const bodyDocument = new JSDOM("<p>body only</p>").window.document
    expect(extractArticleRoot(bodyDocument).html).toContain("body only")
    expect(
      extractReadableArticle(new JSDOM("").window.document)
    ).toBeUndefined()
  })
})

describe("public conversion failure mapping", () => {
  it("accepts string/URL inputs and reports diagnostics", async () => {
    const result = await convertArticleHtml(
      "<p>body</p>",
      new URL("https://x.test")
    )
    expect(result.diagnostics).toMatchObject({
      profileId: "generic",
      inputBytes: 11,
    })
    expect(result.diagnostics.durationMilliseconds).toBeGreaterThanOrEqual(0)
  })

  it("maps invalid URL, UTF-8, empty content, and output expansion", async () => {
    await expect(convertArticleHtml("<p>x</p>", "not a URL")).rejects.toEqual(
      failure("MalformedResponse")
    )
    await expect(
      convertArticleHtml(new Uint8Array([0xff]), "https://x.test")
    ).rejects.toEqual(failure("MalformedResponse"))
    await expect(
      convertArticleHtml("<div> </div>", "https://x.test")
    ).rejects.toEqual(failure("MalformedResponse"))
    await expect(
      convertArticleHtml(`<p>${"\\".repeat(525_000)}</p>`, "https://x.test")
    ).rejects.toEqual(failure("ResourceLimit"))
  })
})
