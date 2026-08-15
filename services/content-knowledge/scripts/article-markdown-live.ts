import { createArticleArchiveArtifacts } from "../src/infrastructure/unsafe/article-markdown/index.js"

const CASES = [
  {
    name: "Zenn Markdown guide",
    url: "https://zenn.dev/zenn/articles/markdown-guide",
    expected: "Markdown",
  },
  {
    name: "Zenn callout article",
    url: "https://zenn.dev/ricora/articles/5a170c17933c3f",
    expected: "callout",
  },
  {
    name: "Qiita Markdown guide",
    url: "https://qiita.com/Qiita/items/c686397e4a0f4f11683d",
    expected: "Markdown",
  },
  {
    name: "GitHub Docs",
    url: "https://docs.github.com/en/get-started/writing-on-github",
    expected: "GitHub",
  },
  {
    name: "Shiki transformers",
    url: "https://shiki.style/packages/transformers",
    expected: "Transformer",
  },
  {
    name: "MDN closures",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures",
    expected: "Closure",
  },
  {
    name: "WordPress Developer Blog",
    url: "https://developer.wordpress.org/news/2026/05/whats-new-for-developers-may-2026/",
    expected: "WordPress 7.0",
  },
] as const

for (const fixture of CASES) {
  const response = await fetch(fixture.url, {
    headers: { "User-Agent": "NewsPodcastArticleMarkdownLive/1.0" },
  })
  if (!response.ok) throw new Error(`${fixture.name}: HTTP ${response.status}`)
  const raw = new Uint8Array(await response.arrayBuffer())
  const artifacts = await createArticleArchiveArtifacts(raw, fixture.url)
  const markdown = new TextDecoder().decode(artifacts.markdown)
  if (!markdown.toLowerCase().includes(fixture.expected.toLowerCase()))
    throw new Error(`${fixture.name}: expected body marker was not preserved`)
  if (/\b(?:navigation|cookie preferences)\b/i.test(markdown.slice(0, 500)))
    throw new Error(`${fixture.name}: page chrome leaked into article start`)
  console.log(
    JSON.stringify({
      name: fixture.name,
      profile: artifacts.diagnostics.profileId,
      rules: artifacts.diagnostics.appliedRules,
      inputBytes: artifacts.diagnostics.inputBytes,
      markdownBytes: artifacts.diagnostics.markdownBytes,
    })
  )
}
