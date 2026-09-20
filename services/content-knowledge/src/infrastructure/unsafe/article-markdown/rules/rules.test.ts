import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"

import type { FeatureRule, SiteProfile } from "../core/contracts.js"
import { zennProfile } from "../profiles/zenn.js"
import { calloutRule } from "./callout/rule.js"
import { serializeCodeMetadata } from "./code/metadata.js"
import { createCodeRule } from "./code/rule.js"
import { embedRule } from "./embed/rule.js"
import { mathRule } from "./math.js"
import { applyFeatureRules } from "./registry.js"
import { safeUrlShapeRule } from "./safe-url-shape.js"

const context = { sourceUrl: new URL("https://example.com/article") }
const documentOf = (html: string): Document => new JSDOM(html).window.document

describe("feature rule registry", () => {
  it("keeps order and reports only rules that changed the document", async () => {
    const events: string[] = []
    const rule = (id: string, count: number): FeatureRule => ({
      id,
      phase: "normalize",
      transform: () => {
        events.push(id)
        return count
      },
    })
    await expect(
      applyFeatureRules(
        [rule("first", 0), rule("second", 2)],
        context,
        documentOf("")
      )
    ).resolves.toEqual(["second"])
    expect(events).toEqual(["first", "second"])
  })
})

describe("code rule", () => {
  it("serializes every supported metadata field", () => {
    expect(
      serializeCodeMetadata({
        language: "ts",
        title: 'a"b\\c.ts',
        showLineNumbers: true,
        startLine: 10,
        highlight: [1, 3],
        diffAdd: [2],
        diffRemove: [4],
      })
    ).toBe(
      'title="a\\"b\\\\c.ts" showLineNumbers=true startLine=10 highlight="1,3" diffAdd="2" diffRemove="4"'
    )
    expect(
      serializeCodeMetadata({
        showLineNumbers: false,
        highlight: [],
        diffAdd: [],
        diffRemove: [],
      })
    ).toBe("showLineNumbers=false")
  })

  it("normalizes framework metadata, line decorations and explicit priority", async () => {
    const document =
      documentOf(`<div class="code-wrapper line-numbers" data-lang="go" data-start-line="8">
      <span class="filename">main.ts</span><pre><code>
      <span class="line highlighted">a</span><span class="line diff add">b</span><span class="line diff remove">c</span>
      </code></pre></div>`)
    expect(await createCodeRule().transform(context, document)).toBe(1)
    const pre = document.querySelector("pre")!
    expect(pre.querySelector("code")?.className).toBe("language-go")
    expect(pre.dataset.articleCodeMeta).toContain('title="main.ts"')
    expect(pre.dataset.articleCodeMeta).toContain("showLineNumbers=true")
    expect(pre.dataset.articleCodeMeta).toContain("startLine=8")
    expect(pre.dataset.articleCodeMeta).toContain('highlight="1"')
    expect(pre.dataset.articleCodeMeta).toContain('diffAdd="2"')
    expect(pre.dataset.articleCodeMeta).toContain('diffRemove="3"')
  })

  it("uses filename, shebang, injected model, and plain fallbacks", async () => {
    const profile = {
      id: "zenn",
      hosts: ["example.com"],
      articleRoot: "body",
      remove: [],
      filenameSelectors: [".name"],
      callouts: [],
    } satisfies SiteProfile
    const filename = documentOf(
      '<div class="code-wrapper"><b class="name">x.py</b><pre><code>print(1)</code></pre></div>'
    )
    await createCodeRule().transform({ ...context, profile }, filename)
    expect(filename.querySelector("code")?.className).toBe("language-python")

    const shebang = documentOf("<pre><code>#!/bin/sh\necho ok</code></pre>")
    await createCodeRule().transform(context, shebang)
    expect(shebang.querySelector("code")?.className).toBe("language-sh")

    const modeled = documentOf(
      `<pre><code>${"const value: number = 1;\n".repeat(10)}</code></pre>`
    )
    await createCodeRule(async () => [
      { languageId: "ts", confidence: 0.9 },
      { languageId: "js", confidence: 0.1 },
    ]).transform(context, modeled)
    expect(modeled.querySelector("code")?.className).toBe("language-ts")

    const plain = documentOf("<pre>plain</pre>")
    await createCodeRule().transform(context, plain)
    expect(plain.querySelector("code")?.className).toBe("")
  })
})

describe("callout rule", () => {
  it("converts profile, generic, open and folded callouts without duplicates", () => {
    const document = documentOf(`<main>
      <aside class="site"><b class="msg-title">Site title</b><p>body</p></aside>
      <div data-callout-type="INFO"><p>info</p></div>
      <div class="custom-block tip"><p class="custom-block-title">Tip title</p><p>tip</p></div>
      <details data-callout-type="bug"><div data-callout-title>Bug title</div><p>bug</p></details>
      <details open data-callout-type="example"><p>example</p></details>
      <div class="custom-block"><p>unknown</p></div>
    </main>`)
    const profile = {
      id: "zenn",
      hosts: [],
      articleRoot: "main",
      remove: [],
      filenameSelectors: [],
      callouts: [{ selector: ".site", type: "warning" }],
    } satisfies SiteProfile
    expect(calloutRule.transform({ ...context, profile }, document)).toBe(5)
    const markers = Array.from(
      document.querySelectorAll("blockquote > p:first-child")
    ).map((node) => node.textContent)
    expect(markers).toEqual([
      "[!warning] Site title",
      "[!info]",
      "[!tip] Tip title",
      "[!bug]- Bug title",
      "[!example]+",
    ])
  })
})

describe("embed, math, and URL rules", () => {
  it("normalizes valid iframe/card URLs and skips invalid or detached cards", () => {
    const document = documentOf(`<main>
      <iframe src="/embed/x"></iframe><iframe src="javascript:x"></iframe><iframe src="http://["></iframe>
      <div class="embed-block"><a href="/card">card</a><a href="/detached">other</a></div>
      <a class="link-card" href="/standalone">standalone</a>
      <a class="link-card">missing</a>
      <a class="link-card" href="mailto:x@example.com">mail</a>
    </main>`)
    expect(embedRule.transform(context, document)).toBe(3)
    expect(document.body.textContent).toContain("@embed")
    expect(document.body.textContent).toContain("@card")
    expect(document.querySelectorAll("iframe")).toHaveLength(2)
  })

  it("preserves TeX annotations and ignores incomplete math", () => {
    const document =
      documentOf(`<div class="katex-display"><math><annotation encoding="application/x-tex">x^2</annotation></math></div>
      <span class="katex"><math><annotation encoding="application/x-tex">a+b</annotation></math></span>
      <div class="katex-display"><annotation encoding="application/x-tex"> </annotation></div>
      <annotation encoding="application/x-tex">orphan</annotation>`)
    expect(mathRule.transform(context, document)).toBe(4)
    expect(document.querySelector("code.language-math")?.textContent).toBe(
      "x^2"
    )
    expect(
      document.querySelector("code.language-math-inline")?.textContent
    ).toBe("a+b")
    expect(document.querySelectorAll("annotation")).toHaveLength(2)
  })

  it("keeps safe links and makes invalid/dangerous links inert", () => {
    const document = documentOf(
      '<a href="/ok">ok</a><a href="http://public.example/x">http</a><a href="mailto:a@b.test">mail</a><a href="javascript:x">bad</a><a href="http://[">invalid</a>'
    )
    expect(safeUrlShapeRule.transform(context, document)).toBe(2)
    expect(
      Array.from(document.querySelectorAll("a")).map((a) =>
        a.getAttribute("href")
      )
    ).toEqual(["/ok", "http://public.example/x", "mailto:a@b.test", "", ""])
  })
})

// Input state                         → preserved output
// Matching profile + valid URL        → card/embed + matching fallback removed
// Matching profile + Mermaid/TeX      → code/math source, never executable HTML
// Invalid/empty/missing URI payload   → existing iframe fallback or unchanged DOM
// No matching profile                 → generic rules only
// Nested rendered KaTeX               → outer display mode retained
describe("profile source payloads", () => {
  const zennContext = {
    sourceUrl: new URL("https://zenn.dev/a/articles/b"),
    profile: zennProfile,
  }

  it.each([
    ["card", "https://example.com/a?q=1&b=2#c", "card"],
    ["github", "https://github.com/a/b/blob/main/a.ts#L1-L3", "embed"],
  ])(
    "restores %s URLs once and removes only the matching fallback",
    (kind, url, directive) => {
      const document = documentOf(
        `<span class="embed-block zenn-embedded-${kind}"><iframe src="https://embed.zenn.studio/${kind}" data-content="${encodeURIComponent(url)}"></iframe></span><a href="${url}">fallback</a><a href="/keep">keep</a>`
      )
      expect(embedRule.transform(zennContext, document)).toBe(1)
      expect(
        document.querySelectorAll("[data-article-directive]")
      ).toHaveLength(1)
      const link = document.querySelector("[data-article-directive]")!
      expect(link.getAttribute("href")).toBe(url)
      expect(link.textContent).toBe(directive)
      expect(document.body.textContent).not.toContain("fallback")
      expect(document.body.textContent).toContain("keep")
    }
  )

  it.each(["%ZZ", "", "%20", "javascript%3Aalert(1)", "http%3A%2F%2F%5B"])(
    "falls back for unusable encoded URL %s",
    (payload) => {
      const document = documentOf(
        `<span class="zenn-embedded-card"><iframe src="https://embed.zenn.studio/card" data-content="${payload}"></iframe></span>`
      )
      expect(embedRule.transform(zennContext, document)).toBe(1)
      expect(
        document.querySelector("[data-article-directive]")?.textContent
      ).toBe("embed")
      expect(document.querySelector("a")?.getAttribute("href")).toBe(
        "https://embed.zenn.studio/card"
      )
    }
  )

  it("leaves incomplete payloads and unrelated siblings intact", () => {
    const document = documentOf(
      '<span class="zenn-embedded-card"></span><span class="zenn-embedded-github"><iframe data-content="https%3A%2F%2Fgithub.com%2Fa"></iframe></span><a href="/other">other</a>'
    )
    expect(embedRule.transform(zennContext, document)).toBe(1)
    expect(document.querySelector('a[href="/other"]')).not.toBeNull()
  })

  it("does not interpret site-specific payloads without a matching profile", () => {
    const document = documentOf(
      '<span class="zenn-embedded-card"><iframe data-content="https%3A%2F%2Fexample.com"></iframe></span>'
    )
    expect(embedRule.transform(context, document)).toBe(0)
    expect(document.querySelector("iframe")).not.toBeNull()
  })

  it("keeps Mermaid source as text, including HTML-shaped labels", () => {
    const source = 'graph LR\n A["<script>alert(1)</script>"] --> B'
    const document = documentOf(
      `<span class="zenn-embedded-mermaid"><iframe data-content="${encodeURIComponent(source)}"></iframe></span>`
    )
    expect(embedRule.transform(zennContext, document)).toBe(1)
    expect(
      document.querySelector("pre > code.language-mermaid")?.textContent
    ).toBe(source)
    expect(document.querySelector("script")).toBeNull()
  })

  it("restores lazy math and keeps empty sources inert", () => {
    const document = documentOf(
      '<embed-katex display-mode="1">x^2</embed-katex><embed-katex>a+b</embed-katex><embed-katex> </embed-katex>'
    )
    expect(mathRule.transform(zennContext, document)).toBe(2)
    expect(document.querySelector("code.language-math")?.textContent).toBe(
      "x^2"
    )
    expect(
      document.querySelector("code.language-math-inline")?.textContent
    ).toBe("a+b")
    expect(document.querySelectorAll("embed-katex")).toHaveLength(1)
  })

  it("preserves display mode when KaTeX nests an inline container", () => {
    const document = documentOf(
      '<span class="katex-display"><span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span></span>'
    )
    mathRule.transform(context, document)
    expect(document.querySelector("code.language-math")?.textContent).toBe(
      "x^2"
    )
  })
})
