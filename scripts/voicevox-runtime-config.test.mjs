import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const compose = JSON.parse(
  execFileSync("docker", ["compose", "config", "--format", "json"], {
    encoding: "utf8",
  })
)

test("VOICEVOX recovers after a transient process or OOM failure", () => {
  assert.equal(compose.services.voicevox.restart, "unless-stopped")
})
