import assert from "node:assert/strict"
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createEnvironmentFile } from "./setup-env.mjs"

test("environment files containing generated secrets are owner-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "news-podcast-env-"))
  const templatePath = join(directory, ".env.example")
  const targetPath = join(directory, ".env")
  await writeFile(
    templatePath,
    [
      "BETTER_AUTH_SECRET=",
      "DEV_AUTH_PASSWORD=",
      "TELEMETRY_PROXY_TOKEN=",
      "GRAFANA_ADMIN_PASSWORD=",
    ].join("\n") + "\n"
  )

  try {
    await createEnvironmentFile({ targetPath, templatePath })
    assert.equal((await stat(targetPath)).mode & 0o777, 0o600)
    const content = await readFile(targetPath, "utf8")
    assert.doesNotMatch(content, /SECRET=\n|PASSWORD=\n|TOKEN=\n/)

    await chmod(targetPath, 0o644)
    await createEnvironmentFile({ targetPath, templatePath })
    assert.equal((await stat(targetPath)).mode & 0o777, 0o600)
    assert.equal(await readFile(targetPath, "utf8"), content)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("refuses to secure a symlinked environment file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "news-podcast-env-link-"))
  const targetPath = join(directory, ".env")
  const linkedPath = join(directory, "shared-secrets")

  try {
    await writeFile(linkedPath, "SHARED_SECRET=unchanged\n", { mode: 0o644 })
    await chmod(linkedPath, 0o644)
    await symlink(linkedPath, targetPath)

    assert.throws(() => createEnvironmentFile({ targetPath }), /regular file/)
    assert.equal((await stat(linkedPath)).mode & 0o777, 0o644)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
