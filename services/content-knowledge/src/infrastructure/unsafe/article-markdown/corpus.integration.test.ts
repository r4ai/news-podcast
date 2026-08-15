import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import { createArticleArchiveArtifacts } from "./index.js"

type Fixture = Readonly<{
  readonly file: string
  readonly sourceUrl: string
  readonly sha256: string
  readonly includes: readonly string[]
  readonly excludes: readonly string[]
}>

type Manifest = Readonly<{
  readonly capturedAt: string
  readonly fixtures: readonly Fixture[]
}>

const directory = new URL(
  "../../../../fixtures/article-markdown/",
  import.meta.url
)
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", directory), "utf8")
) as Manifest

describe(`real-world minimized article corpus (${manifest.capturedAt})`, () => {
  for (const fixture of manifest.fixtures) {
    it(`converts ${fixture.file} with its recorded provenance`, async () => {
      const html = await readFile(new URL(fixture.file, directory))
      expect(createHash("sha256").update(html).digest("hex")).toBe(
        fixture.sha256
      )
      const artifacts = await createArticleArchiveArtifacts(
        new Uint8Array(html),
        fixture.sourceUrl
      )
      const markdown = new TextDecoder().decode(artifacts.markdown)
      for (const expected of fixture.includes)
        expect(markdown).toContain(expected)
      for (const excluded of fixture.excludes)
        expect(markdown).not.toContain(excluded)
    })
  }
})
