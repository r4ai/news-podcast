import assert from "node:assert/strict"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseEnv } from "node:util"
import test from "node:test"
import {
  createS3Identities,
  scopes,
  writeS3Identities,
} from "./s3-identities.mjs"
const environment = parseEnv(
  readFileSync(new URL("../.env.example", import.meta.url), "utf8")
)
for (const state of [
  "missing",
  "duplicate-access",
  "duplicate-secret",
  "distinct",
]) {
  test(`credential generation: ${state}`, () => {
    const input = { ...environment }
    if (state === "missing") delete input.LIBRARY_S3_SECRET_ACCESS_KEY
    if (state === "duplicate-access")
      input.LIBRARY_S3_ACCESS_KEY_ID = input.CONTENT_S3_ACCESS_KEY_ID
    if (state === "duplicate-secret")
      input.LIBRARY_S3_SECRET_ACCESS_KEY = input.CONTENT_S3_SECRET_ACCESS_KEY
    if (state === "distinct") {
      const config = createS3Identities(input)
      assert.equal(config.identities.length, scopes.length)
      assert.ok(config.identities.every((identity) => !identity.actions))
    } else
      assert.throws(() => createS3Identities(input), /distinct credentials/)
  })
}
test("private identity output is owner-only and rejects symlink destinations", () => {
  const directory = mkdtempSync(join(tmpdir(), "s3-identities-"))
  try {
    const targetPath = join(directory, "identities.json")
    writeS3Identities({ targetPath, environment })
    assert.equal(statSync(targetPath).mode & 0o777, 0o600)
    const linked = join(directory, "linked")
    writeFileSync(linked, "unchanged")
    rmSync(targetPath)
    symlinkSync(linked, targetPath)
    assert.throws(
      () => writeS3Identities({ targetPath, environment }),
      /regular file/
    )
    assert.equal(readFileSync(linked, "utf8"), "unchanged")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test("bucket policy resource injection is rejected", () => {
  assert.throws(
    () => createS3Identities({ ...environment, S3_BUCKET: "*" }),
    /bucket name/
  )
})
