import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { createArticleArchiveArtifacts } from "../services/content-knowledge/src/infrastructure/unsafe/article-markdown/index.js"

/**
 * Content Knowledgeの変換器が実際に出すMarkdownを、Webが読める固定fixtureとして
 * 書き出す。
 *
 * `apps/web`は`services/**`をimportできない(依存境界)。そこで橋渡しはこの
 * rootスクリプトが行い、生成物(`.md`)をcommitする。これが無いとWeb側の描画は
 * 「手書きの近似fixture」でしか検証されず、保存Markdownの実際の姿と食い違って
 * いても誰も気付けない。
 *
 * 使い方:
 *   pnpm markdown:corpus         再生成して書き出す
 *   pnpm markdown:corpus:check   再生成して、commit済みと差があればexit 1
 */

type Fixture = Readonly<{
  readonly file: string
  readonly sourceUrl: string
  readonly sha256: string
}>

type Manifest = Readonly<{
  readonly capturedAt: string
  readonly fixtures: readonly Fixture[]
}>

type CorpusEntry = Readonly<{
  readonly name: string
  readonly sourceFile: string
  readonly sourceUrl: string
  readonly sourceSha256: string
  readonly markdownSha256: string
  readonly markdownBytes: number
  readonly profileId: string
  readonly appliedRules: readonly string[]
}>

const fixturesDirectory = new URL(
  "../services/content-knowledge/fixtures/article-markdown/",
  import.meta.url
)
const outputDirectory = new URL(
  "../apps/web/src/shared/markdown/__fixtures__/",
  import.meta.url
)

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex")

async function buildCorpus(): Promise<{
  readonly files: ReadonlyMap<string, string>
  readonly entries: readonly CorpusEntry[]
}> {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", fixturesDirectory), "utf8")
  ) as Manifest

  const files = new Map<string, string>()
  const entries: CorpusEntry[] = []

  for (const fixture of manifest.fixtures) {
    const html = new Uint8Array(
      await readFile(new URL(fixture.file, fixturesDirectory))
    )
    // 取り違えと改竄を弾く。corpus.integration.test.tsと同じ手順。
    const actual = sha256(html)
    if (actual !== fixture.sha256) {
      throw new Error(
        `${fixture.file}: sha256 mismatch (manifest ${fixture.sha256}, actual ${actual})`
      )
    }

    const artifacts = await createArticleArchiveArtifacts(
      html,
      fixture.sourceUrl
    )
    const markdown = new TextDecoder().decode(artifacts.markdown)
    const name = fixture.file.replace(/\.html$/, "")

    files.set(`${name}.md`, markdown)
    entries.push({
      name,
      sourceFile: fixture.file,
      sourceUrl: fixture.sourceUrl,
      sourceSha256: fixture.sha256,
      markdownSha256: sha256(artifacts.markdown),
      markdownBytes: artifacts.diagnostics.markdownBytes,
      profileId: artifacts.diagnostics.profileId,
      appliedRules: artifacts.diagnostics.appliedRules,
    })
  }

  entries.sort((left, right) => left.name.localeCompare(right.name))
  files.set(
    "corpus.json",
    `${JSON.stringify(
      {
        generatedFrom: "services/content-knowledge/fixtures/article-markdown",
        capturedAt: manifest.capturedAt,
        entries,
      },
      undefined,
      2
    )}\n`
  )
  return { files, entries }
}

async function write(files: ReadonlyMap<string, string>): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  // 元fixtureが消えた時に生成物が残り続けないよう、先に掃除する。
  for (const existing of await readdir(outputDirectory).catch(() => [])) {
    if (!files.has(existing)) {
      await rm(new URL(existing, outputDirectory))
    }
  }
  for (const [name, content] of files) {
    await writeFile(new URL(name, outputDirectory), content, "utf8")
  }
}

async function check(files: ReadonlyMap<string, string>): Promise<string[]> {
  const drifted: string[] = []
  const present = new Set(await readdir(outputDirectory).catch(() => []))
  for (const [name, content] of files) {
    if (!present.has(name)) {
      drifted.push(`${name} (missing)`)
      continue
    }
    const committed = await readFile(new URL(name, outputDirectory), "utf8")
    if (committed !== content) drifted.push(`${name} (differs)`)
  }
  for (const name of present) {
    if (!files.has(name)) drifted.push(`${name} (stale)`)
  }
  return drifted
}

const isCheck = process.argv.includes("--check")
const { files, entries } = await buildCorpus()

if (isCheck) {
  const drifted = await check(files)
  if (drifted.length > 0) {
    console.error(
      `Markdown corpus is out of date. Run \`pnpm markdown:corpus\`:\n  ${drifted.join("\n  ")}`
    )
    process.exit(1)
  }
  console.log(`Markdown corpus: OK (${entries.length} fixtures)`)
} else {
  await write(files)
  console.log(
    `Wrote ${entries.length} fixtures to ${fileURLToPath(outputDirectory)}`
  )
  for (const entry of entries) {
    console.log(
      `  ${entry.name}.md  ${entry.markdownBytes}B  profile=${entry.profileId}  rules=${entry.appliedRules.join(",") || "-"}`
    )
  }
}
