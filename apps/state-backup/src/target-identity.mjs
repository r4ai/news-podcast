import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"

const fail = (reason) => {
  throw new Error(`backup target attestation: ${reason}`)
}
const text = (value, field) => {
  if (typeof value !== "string" || value.trim() === "" || value.length > 2048)
    fail(`${field} is required`)
  return value.trim()
}
const identity = (value, field) => text(value, field).toLowerCase()
const endpoint = (value) => new URL(value).href.replace(/\/$/, "")

/** Binds approval to both credentials without placing either secret in the attestation. */
export const describeTarget = (configuration) => ({
  endpoint: endpoint(configuration.endpoint),
  region: configuration.region,
  forcePathStyle: configuration.forcePathStyle === true,
  bucket: configuration.bucket,
  credentialFingerprint: createHash("sha256")
    .update(
      JSON.stringify([configuration.accessKeyId, configuration.secretAccessKey])
    )
    .digest("hex"),
})

export const assertAttestationCurrent = (attestation, now = new Date()) => {
  if (
    !Number.isFinite(Date.parse(attestation.expiresAt)) ||
    Date.parse(attestation.expiresAt) <= now.getTime()
  )
    fail("approval has expired")
}

/** S3-compatible physical/account isolation is an operator attestation, never a DNS inference. */
export const validateTargetAttestation = (
  configuration,
  document,
  now = new Date()
) => {
  if (document?.schemaVersion !== 1) fail("unsupported schema")
  const targets = {}
  for (const role of ["source", "archive"]) {
    const target = document[role]
    const expected = describeTarget(configuration[role])
    if (
      !target ||
      Object.entries(expected).some(([key, value]) => target[key] !== value)
    )
      fail(`${role} endpoint, bucket, region or credential binding changed`)
    targets[role] = Object.fromEntries(
      [
        "provider",
        "accountId",
        "backendId",
        "failureDomain",
        "administrativeDomain",
      ].map((key) => [key, identity(target[key], `${role}.${key}`)])
    )
  }
  const { source, archive } = targets
  if (
    source.provider === archive.provider &&
    source.accountId === archive.accountId &&
    configuration.source.bucket === configuration.archive.bucket
  )
    fail("same bucket identity")
  if (
    source.provider === archive.provider &&
    source.accountId === archive.accountId
  )
    fail("same provider account")
  for (const key of ["backendId", "failureDomain", "administrativeDomain"])
    if (source[key] === archive[key]) fail(`shared ${key}`)
  const approval = document.approval
  if (!approval) fail("explicit approval is required")
  text(approval.reviewedBy, "approval.reviewedBy")
  text(approval.identityEvidence, "approval.identityEvidence")
  text(approval.permissionEvidence, "approval.permissionEvidence")
  for (const key of [
    "independentFailureDomains",
    "separateAdministrators",
    "archiveCannotModifySource",
    "sourceCannotDeleteArchive",
  ])
    if (approval[key] !== true) fail(`${key} must be explicitly approved`)
  const reviewedAt = Date.parse(approval.reviewedAt)
  const expiresAt = Date.parse(approval.expiresAt)
  if (
    !Number.isFinite(reviewedAt) ||
    reviewedAt > now.getTime() ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= reviewedAt ||
    expiresAt - reviewedAt > 90 * 86400_000
  )
    fail(
      "approval dates must cover at most 90 days and cannot start in the future"
    )
  const result = Object.freeze({
    mode: "operator-attested",
    expiresAt: new Date(expiresAt).toISOString(),
  })
  assertAttestationCurrent(result, now)
  return result
}

export const loadTargetAttestation = async (
  configuration,
  now = new Date()
) => {
  if ((await stat(configuration.targetAttestationFile)).size > 65536)
    fail("file exceeds 64 KiB")
  const body = await readFile(configuration.targetAttestationFile)
  if (body.byteLength > 65536) fail("file exceeds 64 KiB")
  let document
  try {
    document = JSON.parse(body.toString("utf8"))
  } catch {
    fail("invalid JSON")
  }
  return validateTargetAttestation(configuration, document, now)
}
