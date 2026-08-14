import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, test } from "node:test"

import { checkParserBoundaries } from "./check-parser-boundaries.mjs"

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

const createFixture = async (files) => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "news-podcast-parser-boundary-")
  )
  temporaryDirectories.push(rootDirectory)
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = path.join(rootDirectory, relativePath)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, content, "utf8")
    })
  )
  return rootDirectory
}

const validFiles = {
  "services/content-knowledge/src/adapters/http-rss-feed-reader.ts":
    'import "./rss-feed-parser.js"\n',
  "services/content-knowledge/src/adapters/rss-feed-parser.ts":
    'import "fast-xml-parser"\n',
  "services/content-knowledge/src/infrastructure/unsafe/http-s3-article-capture.ts":
    'import "./article-markdown-parser.js"\n',
  "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts":
    [
      'import "hast-util-to-html"',
      'import "rehype-parse"',
      'import "rehype-remark"',
      'import "rehype-sanitize"',
      'import "remark-gfm"',
      'import "remark-stringify"',
      'import "unified"',
    ].join("\n"),
}

describe("checkParserBoundaries", () => {
  test("accepts parser libraries at every structured input boundary", async () => {
    const rootDirectory = await createFixture(validFiles)

    assert.deepEqual(await checkParserBoundaries({ rootDirectory }), [])
  })

  test("rejects a regex parser and a missing parser import", async () => {
    const rootDirectory = await createFixture({
      ...validFiles,
      "services/content-knowledge/src/adapters/rss-feed-parser.ts": [
        'import "fast-xml-parser"',
        "const item = /<item>(.*)<\\/item>/",
      ].join("\n"),
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts":
        'import "unified"\n',
    })

    const violations = await checkParserBoundaries({ rootDirectory })

    assert.deepEqual(
      violations.map(({ rule, file, line, requiredImport }) => ({
        rule,
        file,
        ...(line === undefined ? {} : { line }),
        ...(requiredImport === undefined ? {} : { requiredImport }),
      })),
      [
        {
          rule: "parser-boundary-no-regex-parser",
          file: "services/content-knowledge/src/adapters/rss-feed-parser.ts",
          line: 2,
        },
        {
          rule: "parser-boundary-missing-parser-import",
          file: "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts",
          requiredImport: "hast-util-to-html",
        },
        {
          rule: "parser-boundary-missing-parser-import",
          file: "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts",
          requiredImport: "rehype-parse",
        },
        {
          rule: "parser-boundary-missing-parser-import",
          file: "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts",
          requiredImport: "rehype-remark",
        },
        {
          rule: "parser-boundary-missing-parser-import",
          file: "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts",
          requiredImport: "rehype-sanitize",
        },
        {
          rule: "parser-boundary-missing-parser-import",
          file: "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts",
          requiredImport: "remark-gfm",
        },
        {
          rule: "parser-boundary-missing-parser-import",
          file: "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts",
          requiredImport: "remark-stringify",
        },
      ]
    )
  })
})
