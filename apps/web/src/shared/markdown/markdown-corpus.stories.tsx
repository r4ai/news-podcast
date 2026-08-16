import type { Meta, StoryObj } from "@storybook/react-vite"

import { Markdown } from "./markdown"
import { markdownStory, markdownThemeDecorator } from "./story-helpers"

import azukiazusaDesign from "./__fixtures__/azukiazusa-design.md?raw"
import githubDocs from "./__fixtures__/github-docs.md?raw"
import mdnClosures from "./__fixtures__/mdn-closures.md?raw"
import qiitaGuide from "./__fixtures__/qiita-guide.md?raw"
import shikiTransformers from "./__fixtures__/shiki-transformers.md?raw"
import wordpressBlog from "./__fixtures__/wordpress-blog.md?raw"
import zennCallout from "./__fixtures__/zenn-callout.md?raw"
import zennGuide from "./__fixtures__/zenn-guide.md?raw"

/**
 * Content Knowledgeの変換器が実際に出力したMarkdown(golden corpus)。
 * `pnpm markdown:corpus`が`services/content-knowledge`のfixtureから生成する。
 *
 * `markdown.stories.tsx`が手書きの網羅fixtureであるのに対し、こちらは
 * 「保存されるMarkdownの実際の姿」そのもの。Shiki・KaTeX・Mermaid・埋め込み
 * iframeはjsdomでは描画されないため、実物を確認できるのはここだけ。
 */
const meta = {
  title: "Markdown/Corpus",
  component: Markdown,
  decorators: [markdownThemeDecorator],
  args: { headingBaseLevel: 3 },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Markdown>

export default meta
type Story = StoryObj<typeof meta>

export const ZennGuideLight: Story = markdownStory(zennGuide)
export const ZennGuideDark: Story = markdownStory(zennGuide, "dark")

export const ZennCalloutLight: Story = markdownStory(zennCallout)
export const ZennCalloutDark: Story = markdownStory(zennCallout, "dark")

export const QiitaGuideLight: Story = markdownStory(qiitaGuide)
export const QiitaGuideDark: Story = markdownStory(qiitaGuide, "dark")

export const ShikiTransformersLight: Story = markdownStory(shikiTransformers)
export const ShikiTransformersDark: Story = markdownStory(
  shikiTransformers,
  "dark"
)

export const GithubDocsLight: Story = markdownStory(githubDocs)
export const GithubDocsDark: Story = markdownStory(githubDocs, "dark")

export const MdnClosuresLight: Story = markdownStory(mdnClosures)
export const MdnClosuresDark: Story = markdownStory(mdnClosures, "dark")

export const WordpressBlogLight: Story = markdownStory(wordpressBlog)
export const WordpressBlogDark: Story = markdownStory(wordpressBlog, "dark")

export const AzukiazusaDesignLight: Story = markdownStory(azukiazusaDesign)
export const AzukiazusaDesignDark: Story = markdownStory(
  azukiazusaDesign,
  "dark"
)
