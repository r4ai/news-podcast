#!/usr/bin/env node

import { Buffer } from "node:buffer"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
export const defaultTokenPath = resolve(
  repositoryRoot,
  ".codex/state/grafana-viewer-token"
)
const serviceAccountName = "news-podcast-codex-viewer"

export async function validateGrafanaToken({
  grafanaUrl,
  token,
  fetcher = fetch,
}) {
  let response
  try {
    response = await fetcher(`${grafanaUrl}/api/user`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    throw new Error(
      `Grafana is not reachable at ${grafanaUrl}: ${safeError(error)}`
    )
  }
  if (response.status === 401 || response.status === 403) return false
  if (!response.ok)
    throw new Error(
      `Grafana token validation failed with HTTP ${response.status}`
    )
  return true
}

export async function ensureGrafanaMcpToken({
  grafanaUrl = "http://127.0.0.1:3100",
  tokenPath = defaultTokenPath,
  adminUser = "admin",
  adminPassword = "local-only-change-me",
  fetcher = fetch,
} = {}) {
  const existing = await readOptional(tokenPath)
  if (
    existing &&
    (await validateGrafanaToken({ grafanaUrl, token: existing, fetcher }))
  ) {
    await chmod(tokenPath, 0o600)
    return { status: "reused", tokenPath }
  }

  const authorization = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString("base64")}`
  const request = async (path, init = {}) => {
    let response
    try {
      response = await fetcher(`${grafanaUrl}${path}`, {
        ...init,
        headers: {
          authorization,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(5_000),
      })
    } catch (error) {
      throw new Error(
        `Grafana is not reachable at ${grafanaUrl}: ${safeError(error)}`
      )
    }
    const body = await response.text()
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Grafana admin credentials were rejected while provisioning the local Viewer token"
      )
    }
    if (!response.ok) {
      throw new Error(
        `Grafana Service Account API ${path} failed with HTTP ${response.status}: ${body.slice(0, 200)}`
      )
    }
    return body ? JSON.parse(body) : {}
  }

  const search = await request(
    `/api/serviceaccounts/search?query=${encodeURIComponent(serviceAccountName)}`
  )
  let account = search.serviceAccounts?.find(
    (candidate) => candidate.name === serviceAccountName
  )
  if (!account) {
    account = await request("/api/serviceaccounts", {
      method: "POST",
      body: JSON.stringify({ name: serviceAccountName, role: "Viewer" }),
    })
  }
  if (account.role !== undefined && account.role !== "Viewer") {
    throw new Error(
      `Grafana Service Account ${serviceAccountName} is not read-only Viewer`
    )
  }
  const issued = await request(`/api/serviceaccounts/${account.id}/tokens`, {
    method: "POST",
    body: JSON.stringify({
      name: `codex-local-${Date.now()}`,
      secondsToLive: 0,
    }),
  })
  if (typeof issued.key !== "string" || issued.key.length === 0) {
    throw new Error("Grafana did not return a Service Account token")
  }
  await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 })
  const temporary = `${tokenPath}.tmp`
  await writeFile(temporary, `${issued.key}\n`, { mode: 0o600 })
  await rename(temporary, tokenPath)
  await chmod(tokenPath, 0o600)
  return { status: existing ? "reissued" : "issued", tokenPath }
}

async function readOptional(path) {
  try {
    return (await readFile(path, "utf8")).trim()
  } catch (error) {
    if (error.code === "ENOENT") return undefined
    throw error
  }
}

const safeError = (error) =>
  error instanceof Error ? error.message.slice(0, 200) : "request failed"

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const grafanaUrl =
    process.env.GRAFANA_LOCAL_URL?.trim() || "http://127.0.0.1:3100"
  const environmentToken = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN?.trim()
  if (environmentToken) {
    if (
      !(await validateGrafanaToken({ grafanaUrl, token: environmentToken }))
    ) {
      throw new Error(
        "GRAFANA_SERVICE_ACCOUNT_TOKEN was rejected with HTTP 401/403"
      )
    }
    console.log("Grafana MCP environment token is valid.")
  } else {
    const result = await ensureGrafanaMcpToken({
      grafanaUrl,
      adminUser: process.env.GRAFANA_ADMIN_USER?.trim() || "admin",
      adminPassword:
        process.env.GRAFANA_ADMIN_PASSWORD?.trim() || "local-only-change-me",
    })
    console.log(
      `Grafana MCP Viewer token ${result.status}: ${result.tokenPath}`
    )
  }
}
