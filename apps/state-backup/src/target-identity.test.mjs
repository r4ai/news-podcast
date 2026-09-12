import assert from "node:assert/strict"
import test from "node:test"
import {
  describeTarget,
  validateTargetAttestation,
} from "./target-identity.mjs"

const now = new Date("2026-09-11T00:00:00Z")
const fixture = () => {
  const configuration = Object.fromEntries(
    ["source", "archive"].map((role) => [
      role,
      {
        endpoint: `https://${role}.example.invalid`,
        region: "test-region",
        bucket: role,
        accessKeyId: `${role}-key`,
        secretAccessKey: `${role}-secret`,
      },
    ])
  )
  const document = {
    schemaVersion: 1,
    ...Object.fromEntries(
      ["source", "archive"].map((role) => [
        role,
        {
          ...describeTarget(configuration[role]),
          provider: "compatible-provider",
          accountId: `${role}-account`,
          backendId: `${role}-backend`,
          failureDomain: `${role}-datacenter`,
          administrativeDomain: `${role}-administrators`,
        },
      ])
    ),
    approval: {
      reviewedBy: "operator",
      reviewedAt: now.toISOString(),
      expiresAt: "2026-10-01T00:00:00Z",
      identityEvidence: "approved-inventory-report",
      permissionEvidence: "policy-and-permission-test-report",
      independentFailureDomains: true,
      separateAdministrators: true,
      archiveCannotModifySource: true,
      sourceCannotDeleteArchive: true,
    },
  }
  return { configuration, document }
}

test("independent compatible targets require explicit current approval and remain operator-attested", () => {
  const { configuration, document } = fixture()
  assert.deepEqual(validateTargetAttestation(configuration, document, now), {
    mode: "operator-attested",
    expiresAt: "2026-10-01T00:00:00.000Z",
  })
})

for (const [name, change, expected] of [
  [
    "same bucket behind DNS aliases",
    ({ configuration, document }) => {
      configuration.archive.bucket = configuration.source.bucket
      document.archive.bucket = configuration.source.bucket
      document.archive.accountId = document.source.accountId
    },
    /same bucket identity/,
  ],
  [
    "different buckets in the same account",
    ({ document }) => {
      document.archive.accountId = document.source.accountId
    },
    /same provider account/,
  ],
  [
    "aliases to the same backend",
    ({ document }) => {
      document.archive.backendId = document.source.backendId
    },
    /shared backendId/,
  ],
  [
    "shared failure domain with different case",
    ({ document }) => {
      document.archive.failureDomain =
        document.source.failureDomain.toUpperCase()
    },
    /shared failureDomain/,
  ],
  [
    "shared administrators",
    ({ document }) => {
      document.archive.administrativeDomain =
        document.source.administrativeDomain
    },
    /shared administrativeDomain/,
  ],
  [
    "missing provider identity",
    ({ document }) => {
      delete document.source.provider
    },
    /source.provider is required/,
  ],
  [
    "missing approval",
    ({ document }) => {
      delete document.approval
    },
    /explicit approval/,
  ],
  [
    "unapproved permissions",
    ({ document }) => {
      document.approval.sourceCannotDeleteArchive = false
    },
    /explicitly approved/,
  ],
  [
    "missing permission evidence",
    ({ document }) => {
      document.approval.permissionEvidence = ""
    },
    /permissionEvidence is required/,
  ],
  [
    "expired approval",
    ({ document }) => {
      document.approval.reviewedAt = "2026-09-01T00:00:00Z"
      document.approval.expiresAt = now.toISOString()
    },
    /expired/,
  ],
  [
    "overlong approval",
    ({ document }) => {
      document.approval.expiresAt = "2027-09-11T00:00:00Z"
    },
    /at most 90 days/,
  ],
  [
    "changed credential",
    ({ configuration }) => {
      configuration.archive.secretAccessKey = "rotated"
    },
    /binding changed/,
  ],
  [
    "changed endpoint alias",
    ({ configuration }) => {
      configuration.archive.endpoint = "https://new-alias.example.invalid"
    },
    /binding changed/,
  ],
])
  test(`rejects ${name}`, () => {
    const data = fixture()
    change(data)
    assert.throws(
      () => validateTargetAttestation(data.configuration, data.document, now),
      expected
    )
  })

test("startup loads a bound approval file and rejects malformed or oversized input", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { loadTargetAttestation } = await import("./target-identity.mjs")
  const directory = await mkdtemp(join(tmpdir(), "backup-approval-"))
  const data = fixture()
  data.configuration.targetAttestationFile = join(directory, "approval.json")
  try {
    await writeFile(
      data.configuration.targetAttestationFile,
      JSON.stringify(data.document)
    )
    assert.equal(
      (await loadTargetAttestation(data.configuration, now)).mode,
      "operator-attested"
    )
    await writeFile(data.configuration.targetAttestationFile, "{")
    await assert.rejects(
      loadTargetAttestation(data.configuration, now),
      /invalid JSON/
    )
    await writeFile(data.configuration.targetAttestationFile, " ".repeat(65537))
    await assert.rejects(
      loadTargetAttestation(data.configuration, now),
      /exceeds 64 KiB/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
