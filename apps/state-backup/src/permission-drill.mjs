import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import { randomUUID } from "node:crypto"
import { loadTargetConfiguration, s3Client } from "./main.mjs"

const denied = (error) =>
  error?.$metadata?.httpStatusCode === 403 &&
  ["AccessDenied", "InvalidAccessKeyId"].includes(error.name)

/** Explicit operator drill. Never touches an existing object or runs in the backup scheduler. */
export const runPermissionDrill = async (
  configuration,
  createClient = s3Client
) => {
  const clients = []
  const open = (target, credentials) => {
    const client = createClient({
      ...target,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    })
    clients.push(client)
    return client
  }
  const probe = async (client, command, operation) => {
    try {
      await client.send(command, { abortSignal: AbortSignal.timeout(10_000) })
    } catch (error) {
      if (denied(error)) return
      throw new Error(`permission isolation unproven: ${operation}`)
    }
    throw new Error(`permission isolation violated: ${operation}`)
  }
  try {
    // A revoked/invalid credential must not masquerade as successful isolation.
    for (const role of ["source", "archive"]) {
      try {
        await open(configuration[role], configuration[role]).send(
          new ListObjectsV2Command({
            Bucket: configuration[role].bucket,
            MaxKeys: 1,
          }),
          { abortSignal: AbortSignal.timeout(10_000) }
        )
      } catch {
        throw new Error(`permission drill cannot authenticate/list ${role}`)
      }
    }
    const archiveOnSource = open(configuration.source, configuration.archive)
    const sourceOnArchive = open(configuration.archive, configuration.source)
    const nonce = randomUUID()
    for (const prefix of ["articles/", "episodes/"]) {
      const input = {
        Bucket: configuration.source.bucket,
        Key: `${prefix}.backup-isolation-probe-${nonce}`,
      }
      await probe(
        archiveOnSource,
        new PutObjectCommand({ ...input, Body: "", IfNoneMatch: "*" }),
        "archive_put_source"
      )
      await probe(
        archiveOnSource,
        new DeleteObjectCommand(input),
        "archive_delete_source"
      )
      await probe(
        archiveOnSource,
        new DeleteObjectCommand({ ...input, VersionId: "null" }),
        "archive_delete_source_version"
      )
    }
    const input = {
      Bucket: configuration.archive.bucket,
      Key: `generations/.backup-isolation-probe-${nonce}`,
    }
    await probe(
      sourceOnArchive,
      new PutObjectCommand({ ...input, Body: "", IfNoneMatch: "*" }),
      "source_put_archive"
    )
    await probe(
      sourceOnArchive,
      new DeleteObjectCommand(input),
      "source_delete_archive"
    )
    await probe(
      sourceOnArchive,
      new DeleteObjectCommand({ ...input, VersionId: "null" }),
      "source_delete_archive_version"
    )
    return {
      checked: 9,
      outcome: "denied",
      scope: "reserved probe keys only; full policy review remains required",
    }
  } finally {
    for (const client of clients) client.destroy?.()
  }
}

if (import.meta.filename === process.argv[1]) {
  if (!process.argv.includes("--probe"))
    throw new Error("explicit --probe is required; see the recovery runbook")
  runPermissionDrill(loadTargetConfiguration(process.env)).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message)
      process.exitCode = 1
    }
  )
}
