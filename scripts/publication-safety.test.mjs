import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { lstatSync, readFileSync, readlinkSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))

const readTrackedText = (path) => {
  const absolutePath = resolve(repositoryRoot, path)
  const metadata = lstatSync(absolutePath)
  if (metadata.isSymbolicLink()) return readlinkSync(absolutePath)
  if (!metadata.isFile() || metadata.size > 2_000_000) return undefined
  const content = readFileSync(absolutePath)
  return content.includes(0) ? undefined : content.toString("utf8")
}

const trackedTextFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: repositoryRoot })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ path, content: readTrackedText(path) }))
    .filter(({ content }) => content !== undefined)

test("tracked public files contain no concrete operator paths or backup receipts", () => {
  const forbidden = [
    /\/(?:home|Users)\/(?!<)[^/\s]+\//,
    /content-\d{8}T\d{6}Z\.sqlite/,
  ]
  const violations = trackedTextFiles()
    .filter(({ content }) => forbidden.some((pattern) => pattern.test(content)))
    .map(({ path }) => path)
  assert.deepEqual(
    violations,
    [],
    `Public files contain environment-specific evidence: ${violations.join(", ")}`
  )
})
