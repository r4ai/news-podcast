#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const args = process.argv.slice(2)

const argument = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const baseUrl = (
  argument("base-url", process.env.LOADTEST_BASE_URL) ?? ""
).replace(/\/$/, "")
const inputPath = argument("input", process.env.LOADTEST_COOKIES_FILE)
const outputPath = argument("output", "artifacts/loadtest/sessions.json")
const minimumArticles = Number(argument("minimum-articles", "1"))

const fail = (message) => {
  throw new Error(message)
}

export const validateDistinctOwners = (sessions) => {
  const ownerIds = new Set(
    sessions
      .map((session) => session.ownerId?.trim())
      .filter((ownerId) => typeof ownerId === "string" && ownerId.length > 0)
  )
  if (ownerIds.size < 2)
    throw new Error(
      "at least two sessions with distinct ownerId values are required for owner isolation"
    )
  return sessions
}

const requestJson = async (cookie, path) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
  })
  const body = await response.text()
  if (!response.ok)
    fail(`${path} failed with HTTP ${response.status}: ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

const readCookies = async () => {
  if (!inputPath) fail("--input or LOADTEST_COOKIES_FILE is required")
  const value = JSON.parse(await readFile(inputPath, "utf8"))
  const entries = Array.isArray(value) ? value : value.sessions
  if (!Array.isArray(entries) || entries.length === 0)
    fail("cookie input must contain a non-empty array")
  const sessions = entries.map((entry, index) => {
    const session = typeof entry === "string" ? { cookie: entry } : entry
    if (typeof session?.ownerId !== "string" || session.ownerId.trim() === "")
      fail(`session ${index} must include a non-empty ownerId`)
    return session
  })
  return validateDistinctOwners(sessions)
}

const idsFrom = (value) =>
  (value?.items ?? [])
    .map((item) => item.id ?? item.jobId ?? item.episodeId)
    .filter((id) => typeof id === "string")

export const writeSessionFixture = async (
  outputPath,
  sessions,
  generatedAt = new Date().toISOString()
) => {
  const content = `${JSON.stringify({ generatedAt, sessions }, null, 2)}\n`
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, { encoding: "utf8", mode: 0o600 })
  await chmod(outputPath, 0o600)
}

const main = async () => {
  if (!baseUrl) fail("--base-url or LOADTEST_BASE_URL is required")
  const cookies = await readCookies()
  const sessions = []
  for (const [index, input] of cookies.entries()) {
    if (typeof input.cookie !== "string" || input.cookie.trim() === "")
      fail(`session ${index} has no cookie`)
    const articles = await requestJson(
      input.cookie,
      "/v1/me/articles?limit=100&sort=newest"
    )
    const articleIds = (articles.items ?? [])
      .map((article) => article.id)
      .filter((id) => typeof id === "string")
    if (articleIds.length < minimumArticles)
      fail(`session ${index} has only ${articleIds.length} articles`)
    const feeds = await requestJson(input.cookie, "/v1/feeds")
    const jobs = await requestJson(input.cookie, "/v1/episode-jobs?limit=100")
    const episodes = await requestJson(input.cookie, "/v1/episodes?limit=100")
    sessions.push({
      cookie: input.cookie,
      ownerId: input.ownerId,
      articleIds,
      feedIds: idsFrom(feeds),
      jobIds: idsFrom(jobs),
      episodeIds: idsFrom(episodes),
    })
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeSessionFixture(outputPath, sessions)
  console.log(`prepared ${sessions.length} load-test sessions at ${outputPath}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
