import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { ensureGrafanaMcpToken } from "./ensure-grafana-mcp-token.mjs"

const directories = []
test.afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

const temporaryTokenPath = async () => {
  const directory = await mkdtemp(join(tmpdir(), "grafana-mcp-token-"))
  directories.push(directory)
  return join(directory, "token")
}

test("issues a 0600 Viewer token without logging or returning the secret", async () => {
  const tokenPath = await temporaryTokenPath()
  let createdRole
  const fetcher = async (url, init = {}) => {
    if (String(url).includes("/search"))
      return Response.json({ serviceAccounts: [] })
    if (String(url).endsWith("/api/serviceaccounts")) {
      createdRole = JSON.parse(init.body).role
      return Response.json({
        id: 7,
        name: "news-podcast-codex-viewer",
        role: "Viewer",
      })
    }
    if (String(url).endsWith("/tokens"))
      return Response.json({ key: "secret-issued-token" })
    throw new Error(`unexpected request: ${url}`)
  }

  const result = await ensureGrafanaMcpToken({ tokenPath, fetcher })

  assert.equal(result.status, "issued")
  assert.equal(createdRole, "Viewer")
  assert.equal(await readFile(tokenPath, "utf8"), "secret-issued-token\n")
  assert.equal((await stat(tokenPath)).mode & 0o777, 0o600)
  assert.equal(JSON.stringify(result).includes("secret-issued-token"), false)
})

test("reuses a valid local token", async () => {
  const tokenPath = await temporaryTokenPath()
  await writeFile(tokenPath, "existing-token\n", { mode: 0o644 })
  const calls = []
  const result = await ensureGrafanaMcpToken({
    tokenPath,
    fetcher: async (url) => {
      calls.push(String(url))
      return Response.json({ id: 1 })
    },
  })

  assert.equal(result.status, "reused")
  assert.equal(calls.length, 1)
  assert.equal((await stat(tokenPath)).mode & 0o777, 0o600)
})

test("reissues only after the stored token is rejected", async () => {
  const tokenPath = await temporaryTokenPath()
  await writeFile(tokenPath, "expired-token\n", { mode: 0o600 })
  const fetcher = async (url) => {
    const path = String(url)
    if (path.endsWith("/api/user"))
      return new Response("unauthorized", { status: 401 })
    if (path.includes("/search")) {
      return Response.json({
        serviceAccounts: [
          { id: 7, name: "news-podcast-codex-viewer", role: "Viewer" },
        ],
      })
    }
    if (path.endsWith("/tokens"))
      return Response.json({ key: "replacement-token" })
    throw new Error(`unexpected request: ${url}`)
  }

  const result = await ensureGrafanaMcpToken({ tokenPath, fetcher })
  assert.equal(result.status, "reissued")
  assert.equal(await readFile(tokenPath, "utf8"), "replacement-token\n")
})
