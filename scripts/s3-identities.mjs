import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import { parseEnv } from "node:util"
import { pathToFileURL } from "node:url"

export const scopes = ["CONTENT", "PRODUCTION", "LIBRARY", "BACKUP_SOURCE"]
const statement = (Action, Resource, Condition) => ({
  Effect: "Allow",
  Action,
  Resource,
  ...(Condition ? { Condition } : {}),
})
export function s3Policies(
  bucket,
  archiveBucket = "REPLACE_WITH_ARCHIVE_BUCKET"
) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error("Invalid S3 bucket name")
  const arn = `arn:aws:s3:::${bucket}`
  const archiveArn = `arn:aws:s3:::${archiveBucket}`
  const policy = (...Statement) => ({ Version: "2012-10-17", Statement })
  return {
    CONTENT: policy(
      statement(
        ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        [`${arn}/articles/*`]
      ),
      statement(["s3:ListBucket"], [arn], {
        StringLike: { "s3:prefix": ["articles/*"] },
      })
    ),
    PRODUCTION: policy(
      statement(["s3:PutObject", "s3:DeleteObject"], [`${arn}/episodes/*`])
    ),
    LIBRARY: policy(statement(["s3:GetObject"], [`${arn}/episodes/*`])),
    BACKUP_SOURCE: policy(
      statement(["s3:GetObject"], [`${arn}/articles/*`, `${arn}/episodes/*`]),
      statement(["s3:ListBucket"], [arn])
    ),
    BACKUP_ARCHIVE: policy(
      statement(
        ["s3:GetObject", "s3:PutObject", "s3:PutObjectRetention"],
        [`${archiveArn}/generations/*`]
      ),
      statement(["s3:ListBucket"], [archiveArn], {
        StringLike: { "s3:prefix": ["generations/*"] },
      }),
      statement(
        ["s3:GetBucketVersioning", "s3:GetBucketObjectLockConfiguration"],
        [archiveArn]
      )
    ),
  }
}
export function createS3Identities(environment) {
  const policies = s3Policies(environment.S3_BUCKET || "news-podcast")
  // Pinned SeaweedFS evaluates ListBucket against bucket/prefix as well as
  // bucket ARN. Retain prefix conditions; AWS templates remain canonical.
  for (const scope of ["CONTENT", "BACKUP_SOURCE"]) {
    const list = policies[scope].Statement.find((entry) =>
      entry.Action.includes("s3:ListBucket")
    )
    list.Resource.push(`${list.Resource[0]}/*`)
  }
  const keys = new Set()
  const secrets = new Set()
  const identities = scopes.map((scope) => {
    const accessKey = environment[`${scope}_S3_ACCESS_KEY_ID`]
    const secretKey = environment[`${scope}_S3_SECRET_ACCESS_KEY`]
    if (
      !accessKey ||
      !secretKey ||
      keys.has(accessKey) ||
      secrets.has(secretKey)
    )
      throw new Error("Each S3 purpose requires nonempty, distinct credentials")
    keys.add(accessKey)
    secrets.add(secretKey)
    return {
      name: scope.toLowerCase().replaceAll("_", "-"),
      credentials: [{ accessKey, secretKey }],
      policyNames: [scope],
    }
  })
  return {
    identities,
    policies: scopes.map((name) => ({
      name,
      content: JSON.stringify(policies[name]),
    })),
  }
}
export function writeS3Identities({ targetPath, environment }) {
  const content =
    JSON.stringify(createS3Identities(environment), null, 2) + "\n"
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 })
  try {
    const metadata = lstatSync(targetPath)
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error("S3 identities path must be a regular file")
    chmodSync(targetPath, 0o600)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  writeFileSync(targetPath, content, { mode: 0o600 })
  chmodSync(targetPath, 0o600)
}
export function generateLocalS3Identities() {
  const environment = {
    ...parseEnv(readFileSync(".env.example", "utf8")),
    ...parseEnv(readFileSync(".env", "utf8")),
    ...process.env,
  }
  writeS3Identities({
    targetPath:
      environment.S3_IDENTITIES_FILE_HOST || ".secrets/s3-identities.json",
    environment,
  })
}
if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  try {
    generateLocalS3Identities()
    console.log(
      "Generated private S3 identities; no credential values printed."
    )
  } catch {
    console.error(
      "S3 identity generation failed; check bucket, distinct credentials and file permissions."
    )
    process.exitCode = 1
  }
}
