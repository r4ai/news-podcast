import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, test } from "node:test"

import { checkArchitecture } from "./check-architecture.mjs"

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
    path.join(tmpdir(), "news-podcast-architecture-")
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

describe("checkArchitecture", () => {
  test("Onionの内向き依存とshared kernel/protocolへの依存を許可する", async () => {
    const rootDirectory = await createFixture({
      "services/identity/src/domain/user.ts":
        'import type { EntityId } from "@news-podcast/kernel"\n',
      "services/identity/src/application/register-user.ts":
        'import type { User } from "../domain/user.js"\nimport type { Command } from "@news-podcast/protocols"\n',
      "services/identity/src/adapters/sqlite-user-repository.ts":
        'import type { RegisterUser } from "../application/register-user.js"\n',
      "services/identity/src/runtime/main.ts":
        'import "../adapters/sqlite-user-repository.js"\nimport "../application/register-user.js"\n',
      "services/identity/src/infrastructure/unsafe/sqlite.ts":
        'import type { User } from "../../domain/user.js"\n',
    })

    assert.deepEqual(await checkArchitecture({ rootDirectory }), [])
  })

  test("domainから同一サービスの外層への依存をすべて拒否する", async () => {
    const rootDirectory = await createFixture({
      "services/content/src/domain/article.ts": [
        'import type { Port } from "../application/port.js"',
        'export { repository } from "../adapters/repository.js"',
        'const runtime = import("../runtime/main.js")',
        'const sqlite = require("../infrastructure/unsafe/sqlite.cjs")',
      ].join("\n"),
    })

    const violations = await checkArchitecture({ rootDirectory })

    assert.deepEqual(
      violations.map(({ rule, sourceLayer, targetLayer, line }) => ({
        rule,
        sourceLayer,
        targetLayer,
        line,
      })),
      [
        {
          rule: "domain-depends-only-on-domain",
          sourceLayer: "domain",
          targetLayer: "application",
          line: 1,
        },
        {
          rule: "domain-depends-only-on-domain",
          sourceLayer: "domain",
          targetLayer: "adapters",
          line: 2,
        },
        {
          rule: "domain-depends-only-on-domain",
          sourceLayer: "domain",
          targetLayer: "runtime",
          line: 3,
        },
        {
          rule: "domain-depends-only-on-domain",
          sourceLayer: "domain",
          targetLayer: "infrastructure",
          line: 4,
        },
      ]
    )
  })

  test("applicationからadapters/runtime/infrastructureへの依存を拒否する", async () => {
    const rootDirectory = await createFixture({
      "services/episode-production/src/application/produce.ts": [
        'import { repository } from "../adapters/repository.js"',
        'import { start } from "../runtime/main.js"',
        'import { rawClient } from "../infrastructure/unsafe/client.js"',
      ].join("\n"),
    })

    const violations = await checkArchitecture({ rootDirectory })

    assert.deepEqual(
      violations.map(({ rule, targetLayer, line }) => ({
        rule,
        targetLayer,
        line,
      })),
      [
        {
          rule: "application-depends-only-inward",
          targetLayer: "adapters",
          line: 1,
        },
        {
          rule: "application-depends-only-inward",
          targetLayer: "runtime",
          line: 2,
        },
        {
          rule: "application-depends-only-inward",
          targetLayer: "infrastructure",
          line: 3,
        },
      ]
    )
  })

  test("新サービスの自己定義classを拒否する", async () => {
    const rootDirectory = await createFixture({
      "services/production/src/domain/job.ts": [
        "export class EpisodeJob {}",
        "export const makeJob = () => ({ _tag: 'Queued' as const })",
      ].join("\n"),
    })

    const violations = await checkArchitecture({ rootDirectory })

    assert.deepEqual(
      violations.map(({ rule, line }) => ({ rule, line })),
      [{ rule: "functional-no-authored-class", line: 1 }]
    )
  })

  test("別サービスへのrelative importとworkspace package importを拒否する", async () => {
    const rootDirectory = await createFixture({
      "services/content/src/application/read.ts":
        'import type { User } from "../../../identity/src/domain/user.js"\n',
      "services/identity/package.json": '{"name":"@news-podcast/identity"}',
      "services/identity/src/domain/user.ts": "export type User = string\n",
      "services/reader/src/application/render.ts":
        'import type { User } from "@news-podcast/identity/domain/user"\n',
    })

    const violations = await checkArchitecture({ rootDirectory })

    assert.deepEqual(
      violations.map(({ rule, sourceService, targetService }) => ({
        rule,
        sourceService,
        targetService,
      })),
      [
        {
          rule: "no-cross-service-import",
          sourceService: "content",
          targetService: "identity",
        },
        {
          rule: "no-cross-service-import",
          sourceService: "reader",
          targetService: "identity",
        },
      ]
    )
  })

  test("servicesがまだ存在しない移行途中のrepositoryでは成功する", async () => {
    const rootDirectory = await createFixture({
      "packages/protocols/src/index.ts": "export type Command = string\n",
    })

    assert.deepEqual(await checkArchitecture({ rootDirectory }), [])
  })

  test("コメント中のimport文字列は依存として扱わない", async () => {
    const rootDirectory = await createFixture({
      "services/content/src/domain/article.ts": [
        '// import "../runtime/main.js"',
        'const example = `import "../adapters/example.js"`',
      ].join("\n"),
    })

    assert.deepEqual(await checkArchitecture({ rootDirectory }), [])
  })
})
