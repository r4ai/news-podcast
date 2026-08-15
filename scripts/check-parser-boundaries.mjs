#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import ts from "typescript"

const PARSER_BOUNDARIES = [
  {
    relativePath:
      "services/content-knowledge/src/adapters/providers/rss/http-feed-reader.ts",
    requiredImports: ["./feed-parser.js"],
    forbidRegex: true,
  },
  {
    relativePath:
      "services/content-knowledge/src/adapters/providers/rss/feed-parser.ts",
    requiredImports: ["fast-xml-parser"],
    forbidRegex: true,
  },
  {
    relativePath:
      "services/content-knowledge/src/infrastructure/unsafe/http-s3-article-capture.ts",
    requiredImports: ["./article-markdown-parser.js"],
    forbidRegex: true,
  },
  {
    relativePaths: [
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts",
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown/serialize/markdown.ts",
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown/serialize/replay.ts",
    ],
    requiredImports: [
      "hast-util-to-html",
      "rehype-parse",
      "rehype-remark",
      "rehype-sanitize",
      "remark-gfm",
      "remark-stringify",
      "unified",
    ],
    aggregateImports: true,
    // The serializer uses a regular expression as a sanitizer schema matcher;
    // regex-based parsing is still rejected at the actual parser boundaries.
    forbidRegex: false,
  },
  {
    relativePath:
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown/extract/dom.ts",
    requiredImports: ["jsdom"],
    forbidRegex: false,
  },
  {
    relativePath:
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown/extract/readability.ts",
    requiredImports: ["@mozilla/readability"],
    forbidRegex: false,
  },
  {
    relativePath:
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown/profiles/zenn.ts",
    requiredImports: ["../core/contracts.js"],
    forbiddenImportPrefixes: [
      "../extract",
      "../serialize",
      "rehype-",
      "@mozilla/readability",
    ],
    forbidRegex: false,
  },
  {
    relativePath:
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown/profiles/qiita.ts",
    requiredImports: ["../core/contracts.js"],
    forbiddenImportPrefixes: [
      "../extract",
      "../serialize",
      "rehype-",
      "@mozilla/readability",
    ],
    forbidRegex: false,
  },
]

const extractImports = (filePath, sourceText) => {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const imports = []
  const regexLiterals = []

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text)
    }
    if (ts.isRegularExpressionLiteral(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile)
      )
      regexLiterals.push(line + 1)
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp"
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile)
      )
      regexLiterals.push(line + 1)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { imports, regexLiterals }
}

export const checkParserBoundaries = async ({
  rootDirectory = process.cwd(),
} = {}) => {
  const absoluteRoot = path.resolve(rootDirectory)
  const violations = []

  for (const boundary of PARSER_BOUNDARIES) {
    const relativePaths = boundary.relativePaths ?? [boundary.relativePath]
    const candidates = []
    for (const relativePath of relativePaths) {
      try {
        const sourceText = await readFile(
          path.join(absoluteRoot, relativePath),
          "utf8"
        )
        const parsed = extractImports(
          path.join(absoluteRoot, relativePath),
          sourceText
        )
        candidates.push({ relativePath, ...parsed })
      } catch (error) {
        if (error?.code !== "ENOENT") throw error
      }
    }

    if (candidates.length === 0) {
      violations.push({
        rule: "parser-boundary-missing-file",
        file: relativePaths[0],
      })
      continue
    }

    const complete = boundary.aggregateImports
      ? candidates[0]
      : candidates.find(({ imports: candidateImports }) =>
          boundary.requiredImports.every((requiredImport) =>
            candidateImports.includes(requiredImport)
          )
        )
    const selected =
      complete ??
      candidates.toSorted(
        (left, right) =>
          boundary.requiredImports.filter(
            (requiredImport) => !left.imports.includes(requiredImport)
          ).length -
          boundary.requiredImports.filter(
            (requiredImport) => !right.imports.includes(requiredImport)
          ).length
      )[0]
    const imports = boundary.aggregateImports
      ? [
          ...new Set(
            candidates.flatMap(
              ({ imports: candidateImports }) => candidateImports
            )
          ),
        ]
      : selected.imports

    for (const requiredImport of boundary.requiredImports) {
      if (!imports.includes(requiredImport)) {
        violations.push({
          rule: "parser-boundary-missing-parser-import",
          file: selected.relativePath,
          requiredImport,
        })
      }
    }
    for (const forbiddenPrefix of boundary.forbiddenImportPrefixes ?? []) {
      for (const imported of imports.filter((value) =>
        value.startsWith(forbiddenPrefix)
      )) {
        violations.push({
          rule: "parser-profile-forbidden-import",
          file: selected.relativePath,
          imported,
        })
      }
    }
    if (boundary.forbidRegex) {
      for (const line of selected.regexLiterals) {
        violations.push({
          rule: "parser-boundary-no-regex-parser",
          file: selected.relativePath,
          line,
        })
      }
    }
  }

  return violations
}

export const formatViolation = (violation) => {
  if (violation.rule === "parser-boundary-missing-file") {
    return `${violation.file} [${violation.rule}] structured parser boundary is missing`
  }
  if (violation.rule === "parser-boundary-missing-parser-import") {
    return `${violation.file} [${violation.rule}] import ${violation.requiredImport}`
  }
  if (violation.rule === "parser-profile-forbidden-import") {
    return `${violation.file} [${violation.rule}] must not import ${violation.imported}`
  }
  return `${violation.file}:${violation.line} [${violation.rule}] use a stateful parser/AST library`
}

const main = async () => {
  const violations = await checkParserBoundaries()
  if (violations.length === 0) {
    console.log("Structured parser boundaries: OK")
    return
  }

  console.error(`Structured parser boundary violations (${violations.length}):`)
  for (const violation of violations) {
    console.error(`- ${formatViolation(violation)}`)
  }
  process.exitCode = 1
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await main()
}
