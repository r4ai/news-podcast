import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"
import { setTimeout } from "node:timers/promises"
import test from "node:test"

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = createRequire(
  new URL("../services/content-knowledge/package.json", import.meta.url)
)("@aws-sdk/client-s3")
const environment = parseEnv(
  readFileSync(new URL("../.env.example", import.meta.url), "utf8")
)
const image =
  "chrislusf/seaweedfs@sha256:e0b528145ea514040ab00d03ff0833f56acb1f0e07aeab232e20485af9278fd8"
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()

test(
  "pinned SeaweedFS enforces purpose, prefix and read/write boundaries",
  { timeout: 90000 },
  async (t) => {
    const name = `news-podcast-s3-policy-${process.pid}`
    const clients = {}
    const directory = mkdtempSync(join(tmpdir(), "s3-private-test-"))
    const privatePath = join(directory, "identities.json")
    writeFileSync(
      privatePath,
      readFileSync(
        new URL(
          "../infra/security/s3-identities.development.json",
          import.meta.url
        )
      ),
      { mode: 0o600 }
    )
    try {
      docker([
        "run",
        "-d",
        "--name",
        name,
        "-p",
        "127.0.0.1::8333",
        "-v",
        `${privatePath}:/run/secrets/s3-identities:ro`,
        "-v",
        `${fileURLToPath(new URL("../infra/security/start-seaweedfs.sh", import.meta.url))}:/start-seaweedfs.sh:ro`,
        "--tmpfs",
        "/run/seaweedfs-secrets:mode=0700",
        "--entrypoint",
        "sh",
        image,
        "/start-seaweedfs.sh",
        "mini",
        "-dir=/data",
        "-s3.config=/run/seaweedfs-secrets/s3-identities.json",
      ])
      const endpoint = `http://${docker(["port", name, "8333/tcp"])}`
      let ready = false
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          await fetch(endpoint, { signal: AbortSignal.timeout(1000) })
          ready = true
          break
        } catch {
          await setTimeout(500)
        }
      }
      assert.ok(ready, "S3 listener became ready")
      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          name,
          "weed",
          "shell",
          "-master=localhost:9333",
          "-filer=localhost:8888",
        ],
        {
          input: "fs.mkdir /buckets/news-podcast\n",
          stdio: ["pipe", "pipe", "pipe"],
        }
      )
      for (const scope of ["CONTENT", "PRODUCTION", "LIBRARY", "BACKUP_SOURCE"])
        clients[scope] = new S3Client({
          endpoint,
          region: "us-east-1",
          forcePathStyle: true,
          maxAttempts: 1,
          credentials: {
            accessKeyId: environment[`${scope}_S3_ACCESS_KEY_ID`],
            secretAccessKey: environment[`${scope}_S3_SECRET_ACCESS_KEY`],
          },
        })
      const Bucket = "news-podcast"
      const request = async (scope, operation, key) => {
        const commands = {
          put: () =>
            new PutObjectCommand({
              Bucket,
              Key: key,
              Body: "isolation fixture",
            }),
          get: () => new GetObjectCommand({ Bucket, Key: key }),
          delete: () => new DeleteObjectCommand({ Bucket, Key: key }),
          list: () =>
            new ListObjectsV2Command({
              Bucket,
              ...(key === undefined ? {} : { Prefix: key }),
            }),
        }
        const response = await clients[scope].send(commands[operation]())
        if (response.Body) await response.Body.transformToByteArray()
      }
      for (const [scope, operation, key, allowed] of [
        ["CONTENT", "put", "articles/test", true],
        ["PRODUCTION", "put", "episodes/test", true],
        ["CONTENT", "get", "articles/test", true],
        ["CONTENT", "list", "articles/", true],
        ["CONTENT", "get", "episodes/test", false],
        ["CONTENT", "put", "episodes/test", false],
        ["CONTENT", "list", "episodes/", false],
        ["CONTENT", "list", undefined, false],
        ["PRODUCTION", "put", "articles/test", false],
        ["PRODUCTION", "get", "episodes/test", false],
        ["LIBRARY", "get", "episodes/test", true],
        ["LIBRARY", "get", "articles/test", false],
        ["LIBRARY", "put", "episodes/forbidden", false],
        ["LIBRARY", "delete", "episodes/test", false],
        ["BACKUP_SOURCE", "get", "articles/test", true],
        ["BACKUP_SOURCE", "get", "episodes/test", true],
        ["BACKUP_SOURCE", "list", undefined, true],
        ["BACKUP_SOURCE", "put", "articles/forbidden", false],
        ["BACKUP_SOURCE", "delete", "episodes/test", false],
        ["CONTENT", "delete", "articles/test", true],
        ["PRODUCTION", "delete", "episodes/test", true],
      ])
        await t.test(
          `${scope} ${operation} ${key ?? "(bucket)"}: ${allowed ? "allow" : "deny"}`,
          async () => {
            if (allowed) await request(scope, operation, key)
            else
              await assert.rejects(
                request(scope, operation, key),
                (error) => error.$metadata?.httpStatusCode === 403
              )
          }
        )
    } finally {
      for (const client of Object.values(clients)) client.destroy()
      docker(["rm", "-f", name])
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
