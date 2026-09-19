import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const allowlists = JSON.parse(
  readFileSync(
    new URL("../infra/security/service-environment.json", import.meta.url),
    "utf8"
  )
)
const knownNames = new Set([
  ...Object.values(allowlists).flat(),
  ...readFileSync(new URL("../.env.example", import.meta.url), "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean),
])
export function unexpectedNames(service, names) {
  const allowed = new Set(allowlists[service])
  return names
    .filter(
      (name) =>
        !allowed.has(name) &&
        (knownNames.has(name) ||
          /SECRET|PASSWORD|TOKEN|API_KEY|ACCESS_KEY/.test(name))
    )
    .sort()
}
export function checkServiceEnvironments({
  runtime = false,
  composeArgs = [],
  run = execFileSync,
} = {}) {
  const base = ["compose", ...composeArgs]
  const config = JSON.parse(
    run("docker", [...base, "config", "--format", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  )
  let failed = false
  for (const service of Object.keys(allowlists).filter(
    (service) => config.services[service]
  )) {
    let names = Object.keys(config.services[service].environment ?? {})
    // Execute in each Node container. The child emits NAMES only, never values.
    if (runtime && !["web", "seaweedfs", "s3-provision"].includes(service))
      names = JSON.parse(
        run(
          "docker",
          [
            ...base,
            "exec",
            "-T",
            service,
            "node",
            "-e",
            "console.log(JSON.stringify(Object.keys(process.env)))",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        )
      )
    const unexpected = unexpectedNames(service, names)
    console.log(
      `${service}: ${unexpected.length === 0 ? "PASS" : `FAIL (${unexpected.join(", ")})`}`
    )
    failed ||= unexpected.length > 0
  }
  if (failed) throw new Error("Environment isolation failed")
}
if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  try {
    checkServiceEnvironments({
      runtime: process.argv.includes("--runtime"),
      composeArgs: process.argv.slice(2).filter((arg) => arg !== "--runtime"),
    })
  } catch {
    console.error(
      "Environment isolation check failed; values and Docker diagnostics suppressed."
    )
    process.exitCode = 1
  }
}
