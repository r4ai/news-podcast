export type ArticleArchiveArtifacts = Readonly<{
  readonly markdown: Uint8Array
  readonly replay: Uint8Array
  readonly diagnostics: ArticleMarkdownDiagnostics
}>

export type ArticleMarkdownDiagnostics = Readonly<{
  readonly profileId: SiteProfileId | "generic"
  readonly appliedRules: readonly string[]
  readonly inputBytes: number
  readonly markdownBytes: number
  readonly durationMilliseconds: number
}>

export type SiteProfileId = "zenn" | "qiita"

export type CalloutHint = Readonly<{
  readonly selector: string
  readonly type: string
}>

export type SiteProfile = Readonly<{
  readonly id: SiteProfileId
  readonly hosts: readonly string[]
  readonly articleRoot: string
  readonly remove: readonly string[]
  readonly filenameSelectors: readonly string[]
  readonly callouts: readonly CalloutHint[]
}>

export type RuleContext = Readonly<{
  readonly sourceUrl: URL
  readonly profile?: SiteProfile
}>

export type FeatureRule = Readonly<{
  readonly id: string
  readonly phase: "preserve" | "normalize"
  transform(context: RuleContext, root: ParentNode): Promise<number> | number
}>

export type LanguageCandidate = Readonly<{
  readonly languageId: string
  readonly confidence: number
}>

export type LanguageDetector = (
  source: string
) => Promise<readonly LanguageCandidate[]>
