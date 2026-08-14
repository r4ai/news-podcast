#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import ts from "typescript"

const PARSER_BOUNDARIES = [
  {
    relativePath:
      "services/content-knowledge/src/adapters/http-rss-feed-reader.ts",
    requiredImports: ["./rss-feed-parser.js"],
    forbidRegex: true,
  },
  {
    relativePath: "services/content-knowledge/src/adapters/rss-feed-parser.ts",
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
    relativePath:
      "services/content-knowledge/src/infrastructure/unsafe/article-markdown-parser.ts",
    requiredImports: [
      "hast-util-to-html",
      "rehype-parse",
      "rehype-remark",
      "rehype-sanitize",
      "remark-gfm",
      "remark-stringify",
      "unified",
    ],
    forbidRegex: true,
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
    const filePath = path.join(absoluteRoot, boundary.relativePath)
    let sourceText
    try {
      sourceText = await readFile(filePath, "utf8")
    } catch (error) {
      if (error?.code === "ENOENT") {
        violations.push({
          rule: "parser-boundary-missing-file",
          file: boundary.relativePath,
        })
        continue
      }
      throw error
    }

    const { imports, regexLiterals } = extractImports(filePath, sourceText)
    for (const requiredImport of boundary.requiredImports) {
      if (!imports.includes(requiredImport)) {
        violations.push({
          rule: "parser-boundary-missing-parser-import",
          file: boundary.relativePath,
          requiredImport,
        })
      }
    }
    if (boundary.forbidRegex) {
      for (const line of regexLiterals) {
        violations.push({
          rule: "parser-boundary-no-regex-parser",
          file: boundary.relativePath,
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
