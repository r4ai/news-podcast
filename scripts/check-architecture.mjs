#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import ts from "typescript"

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
])
const SERVICE_LAYERS = new Set([
  "domain",
  "application",
  "adapters",
  "runtime",
  "infrastructure",
])

const toPortablePath = (filePath) => filePath.split(path.sep).join("/")

const listDirectories = async (directory) => {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (error?.code === "ENOENT") {
      return []
    }
    throw error
  }
}

const listSourceFiles = async (directory) => {
  const files = []

  const visit = async (currentDirectory) => {
    const entries = await readdir(currentDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
      } else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(path.extname(entry.name))
      ) {
        files.push(entryPath)
      }
    }
  }

  await visit(directory)
  return files
}

const classifyServicePath = (rootDirectory, filePath, serviceNames) => {
  const relativePath = path.relative(
    path.join(rootDirectory, "services"),
    filePath
  )
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined
  }

  const [service, sourceDirectory, layer] = relativePath.split(path.sep)
  if (!serviceNames.has(service) || sourceDirectory !== "src") {
    return undefined
  }

  return {
    service,
    layer: SERVICE_LAYERS.has(layer) ? layer : undefined,
  }
}

const readServicePackageNames = async (rootDirectory, services) => {
  const packageNames = new Map()

  await Promise.all(
    services.map(async (service) => {
      try {
        const packageJson = JSON.parse(
          await readFile(
            path.join(rootDirectory, "services", service, "package.json"),
            "utf8"
          )
        )
        if (typeof packageJson.name === "string") {
          packageNames.set(packageJson.name, service)
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw new Error(
            `services/${service}/package.jsonを読み込めません: ${error.message}`,
            {
              cause: error,
            }
          )
        }
      }
    })
  )

  for (const service of services) {
    packageNames.set(`@news-podcast/${service}`, service)
  }

  return packageNames
}

const matchPackageImport = (specifier, packageNames) => {
  const matches = [...packageNames.entries()]
    .filter(
      ([packageName]) =>
        specifier === packageName || specifier.startsWith(`${packageName}/`)
    )
    .sort(([left], [right]) => right.length - left.length)
  const [match] = matches
  if (!match) {
    return undefined
  }

  const [packageName, service] = match
  const [layer] = specifier
    .slice(packageName.length)
    .replace(/^\//, "")
    .split("/")
  return {
    service,
    layer: SERVICE_LAYERS.has(layer) ? layer : undefined,
  }
}

const classifyImport = ({
  rootDirectory,
  sourceFilePath,
  specifier,
  serviceNames,
  packageNames,
}) => {
  if (specifier.startsWith(".")) {
    return classifyServicePath(
      rootDirectory,
      path.resolve(path.dirname(sourceFilePath), specifier),
      serviceNames
    )
  }

  if (path.isAbsolute(specifier)) {
    return classifyServicePath(
      rootDirectory,
      path.normalize(specifier),
      serviceNames
    )
  }

  const packageImport = matchPackageImport(specifier, packageNames)
  if (packageImport) {
    return packageImport
  }

  const servicePath = specifier.match(/(?:^|\/)services\/([^/]+)\/src\/([^/]+)/)
  if (!servicePath || !serviceNames.has(servicePath[1])) {
    return undefined
  }

  return {
    service: servicePath[1],
    layer: SERVICE_LAYERS.has(servicePath[2]) ? servicePath[2] : undefined,
  }
}

const extractImports = (filePath, sourceText) => {
  const scriptKind = filePath.endsWith("x")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  )
  const imports = []

  const record = (node, moduleSpecifier) => {
    if (!moduleSpecifier || !ts.isStringLiteralLike(moduleSpecifier)) {
      return
    }
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    )
    imports.push({ specifier: moduleSpecifier.text, line: line + 1 })
  }

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node, node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node, node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require"
      if (isDynamicImport || isRequire) {
        record(node, node.arguments[0])
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

const dependencyRuleFor = (sourceLayer, targetLayer) => {
  if (sourceLayer === "domain" && targetLayer !== "domain") {
    return "domain-depends-only-on-domain"
  }
  if (
    sourceLayer === "application" &&
    (targetLayer === "adapters" ||
      targetLayer === "runtime" ||
      targetLayer === "infrastructure")
  ) {
    return "application-depends-only-inward"
  }
  return undefined
}

export const checkArchitecture = async ({
  rootDirectory = process.cwd(),
} = {}) => {
  const absoluteRoot = path.resolve(rootDirectory)
  const services = await listDirectories(path.join(absoluteRoot, "services"))
  const serviceNames = new Set(services)
  const packageNames = await readServicePackageNames(absoluteRoot, services)
  const violations = []

  for (const service of services) {
    const sourceRoot = path.join(absoluteRoot, "services", service, "src")
    let sourceFiles
    try {
      sourceFiles = await listSourceFiles(sourceRoot)
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue
      }
      throw error
    }

    for (const sourceFilePath of sourceFiles) {
      const source = classifyServicePath(
        absoluteRoot,
        sourceFilePath,
        serviceNames
      )
      if (!source?.layer) {
        continue
      }
      const sourceText = await readFile(sourceFilePath, "utf8")

      for (const imported of extractImports(sourceFilePath, sourceText)) {
        const target = classifyImport({
          rootDirectory: absoluteRoot,
          sourceFilePath,
          specifier: imported.specifier,
          serviceNames,
          packageNames,
        })
        if (!target) {
          continue
        }

        if (target.service !== source.service) {
          violations.push({
            rule: "no-cross-service-import",
            file: toPortablePath(path.relative(absoluteRoot, sourceFilePath)),
            line: imported.line,
            specifier: imported.specifier,
            sourceService: source.service,
            sourceLayer: source.layer,
            targetService: target.service,
            targetLayer: target.layer,
          })
          continue
        }

        const rule =
          target.layer && dependencyRuleFor(source.layer, target.layer)
        if (rule) {
          violations.push({
            rule,
            file: toPortablePath(path.relative(absoluteRoot, sourceFilePath)),
            line: imported.line,
            specifier: imported.specifier,
            sourceService: source.service,
            sourceLayer: source.layer,
            targetService: target.service,
            targetLayer: target.layer,
          })
        }
      }
    }
  }

  return violations
}

export const formatViolation = (violation) => {
  const dependency = `${violation.sourceService}/${violation.sourceLayer} -> ${violation.targetService}/${violation.targetLayer ?? "package-root"}`
  return `${violation.file}:${violation.line} [${violation.rule}] ${dependency}: ${violation.specifier}`
}

const parseRootDirectory = (arguments_) => {
  if (arguments_.length === 0) {
    return process.cwd()
  }
  if (arguments_.length === 2 && arguments_[0] === "--root") {
    return arguments_[1]
  }
  throw new Error(
    "Usage: node scripts/check-architecture.mjs [--root <repository-root>]"
  )
}

const main = async () => {
  const rootDirectory = parseRootDirectory(process.argv.slice(2))
  const violations = await checkArchitecture({ rootDirectory })
  if (violations.length === 0) {
    console.log("Architecture dependencies: OK")
    return
  }

  console.error(`Architecture dependency violations (${violations.length}):`)
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
