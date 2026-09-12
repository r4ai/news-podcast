import assert from "node:assert/strict"
import test from "node:test"
import { runPermissionDrill } from "./permission-drill.mjs"

const fixture = (extraPermission) => {
  const configuration = Object.fromEntries(
    ["source", "archive"].map((role) => [
      role,
      {
        endpoint: `https://${role}.invalid`,
        bucket: role,
        accessKeyId: role,
        secretAccessKey: `${role}-secret`,
      },
    ])
  )
  const calls = []
  let closed = 0
  const clients = (target) => ({
    async send(command) {
      const action =
        command.constructor.name === "DeleteObjectCommand" &&
        command.input.VersionId !== undefined
          ? "DeleteObjectVersion"
          : command.constructor.name.replace("Command", "")
      const call = {
        principal: target.accessKeyId,
        bucket: command.input.Bucket,
        action,
        key: command.input.Key,
      }
      calls.push(call)
      const ownList =
        call.principal === call.bucket && action === "ListObjectsV2"
      if (!ownList && !extraPermission?.(call)) {
        const error = new Error("denied")
        error.name = "AccessDenied"
        error.$metadata = { httpStatusCode: 403 }
        throw error
      }
      return {}
    },
    destroy() {
      closed += 1
    },
  })
  return { configuration, clients, calls, closed: () => closed }
}

test("both credentials work on their own target but cross-target mutation is denied", async () => {
  const data = fixture()
  assert.equal(
    (await runPermissionDrill(data.configuration, data.clients)).checked,
    8
  )
  assert.equal(data.calls.length, 10)
  assert.equal(data.closed(), 4)
  for (const call of data.calls.filter((call) => call.key !== undefined))
    assert.match(
      call.key,
      /^(articles|episodes|generations)\/\.backup-isolation-probe-[0-9a-f-]{36}$/
    )
})

for (const [principal, bucket, action] of [
  ["archive", "source", "PutObject"],
  ["archive", "source", "DeleteObject"],
  ["archive", "source", "DeleteObjectVersion"],
  ["source", "archive", "DeleteObject"],
  ["source", "archive", "DeleteObjectVersion"],
])
  test(`detects ${principal} credential with ${action} permission on ${bucket}`, async () => {
    const data = fixture(
      (call) =>
        call.principal === principal &&
        call.bucket === bucket &&
        call.action === action
    )
    await assert.rejects(
      runPermissionDrill(data.configuration, data.clients),
      /isolation violated/
    )
    assert.equal(data.closed(), 4)
  })

test("a transport failure is not evidence that cross-target access is denied", async () => {
  const data = fixture()
  await assert.rejects(
    runPermissionDrill(data.configuration, (target) => {
      const client = data.clients(target)
      return {
        ...client,
        send: (command) =>
          command.constructor.name === "ListObjectsV2Command"
            ? client.send(command)
            : Promise.reject(new Error("offline")),
      }
    }),
    /isolation unproven/
  )
})

test("invalid credentials on their own target cannot pass the isolation drill", async () => {
  let probes = 0
  const data = fixture()
  await assert.rejects(
    runPermissionDrill(data.configuration, () => ({
      async send() {
        probes += 1
        throw new Error("credential revoked")
      },
      destroy() {},
    })),
    /cannot authenticate\/list source/
  )
  assert.equal(probes, 1)
})
