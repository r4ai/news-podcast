import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
)

const readWorkflow = async () =>
  readFile(
    path.join(repositoryRoot, ".github", "workflows", "security.yml"),
    "utf8"
  )

const commandStep = (workflow, command) => {
  const pattern = new RegExp(
    `run:\\s*([^\\n]*${command}[^\\n]*)`,
    "g"
  )
  const matches = [...workflow.matchAll(pattern)]
  return matches.map((match) => match[1].trim())
}

describe("security workflow trust boundary", () => {
  test("PRは静的入力として扱い、ヘッドではなくベースブランチをcheckoutする", async () => {
    const workflow = await readWorkflow()

    assert.match(workflow, /pull_request_target:/)
    assert.match(
      workflow,
      /ref:\s*\${{ github\.event\.repository\.default_branch }}/
    )
    assert.match(workflow, /persist-credentials:\s*false/)
  })

  test("PR由来のpnpmfileとlifecycle scriptをinstallとauditの両方で実行しない", async () => {
    const workflow = await readWorkflow()

    const installSteps = commandStep(workflow, "pnpm install")
    assert.ok(
      installSteps.length > 0,
      "pnpm install step must exist"
    )
    for (const step of installSteps) {
      assert.match(step, /--ignore-pnpmfile/)
      assert.match(step, /--ignore-scripts/)
      assert.match(step, /--frozen-lockfile/)
    }

    const auditSteps = commandStep(workflow, "pnpm audit")
    assert.ok(auditSteps.length > 0, "pnpm audit step must exist")
    for (const step of auditSteps) {
      // audit は --ignore-pnpmfile を受け付けないため、config名前空間で無効化する。
      assert.match(step, /--config\.ignore-pnpmfile=true/)
    }
  })

  test("workflowとジョブの権限はread-onlyのままである", async () => {
    const workflow = await readWorkflow()

    assert.match(workflow, /^permissions:\s*\{\}\s*$/m)
    assert.match(workflow, /contents:\s*read/)
    assert.match(workflow, /pull-requests:\s*read/)
    assert.doesNotMatch(workflow, /contents:\s*write/)
    assert.doesNotMatch(workflow, /id-token:\s*write/)
  })
})
