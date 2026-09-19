import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const compose = JSON.parse(
  execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      "--profile",
      "backup",
      "config",
      "--format",
      "json",
    ],
    { encoding: "utf8" }
  )
)
const secrets = [
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "DEV_AUTH_PASSWORD",
  "OPENAI_API_KEY",
  "S3_SECRET_ACCESS_KEY",
  "BACKUP_ARCHIVE_SECRET_ACCESS_KEY",
  "WATCHDOG_SMTP_PASSWORD",
  "GRAFANA_ADMIN_PASSWORD",
]
const owners = {
  gateway: [],
  "identity-access": [
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "DEV_AUTH_PASSWORD",
  ],
  "content-knowledge": ["OPENAI_API_KEY", "S3_SECRET_ACCESS_KEY"],
  "episode-production": ["OPENAI_API_KEY", "S3_SECRET_ACCESS_KEY"],
  "episode-library": ["S3_SECRET_ACCESS_KEY"],
  "state-backup": ["S3_SECRET_ACCESS_KEY", "BACKUP_ARCHIVE_SECRET_ACCESS_KEY"],
}
for (const [service, allowed] of Object.entries(owners)) {
  test(`${service} contains only owned representative secret names, even if values are empty`, () => {
    const names = Object.keys(compose.services[service].environment)
    assert.deepEqual(
      secrets.filter((name) => names.includes(name) && !allowed.includes(name)),
      []
    )
  })
}
test("S3 credentials are distinct for each application purpose", () => {
  const services = [
    "content-knowledge",
    "episode-production",
    "episode-library",
    "state-backup",
  ]
  assert.equal(
    new Set(
      services.map(
        (service) => compose.services[service].environment.S3_ACCESS_KEY_ID
      )
    ).size,
    services.length
  )
})

const { allowlists, unexpectedNames } =
  await import("./check-service-environment.mjs")
for (const [service, allowed] of Object.entries(allowlists)) {
  test(`${service} Compose injection matches the explicit allowlist`, () => {
    const names = Object.keys(compose.services[service].environment)
    assert.deepEqual(
      names.filter((name) => !allowed.includes(name)),
      []
    )
  })
}
for (const [label, names, expected] of [
  ["image defaults", ["PATH", "NODE_VERSION", "PNPM_HOME"], []],
  ["foreign empty secret", ["BETTER_AUTH_SECRET"], ["BETTER_AUTH_SECRET"]],
  [
    "unknown injected secret",
    ["NEW_PROVIDER_API_KEY"],
    ["NEW_PROVIDER_API_KEY"],
  ],
  ["own credential", ["TELEMETRY_PROXY_TOKEN"], []],
])
  test(`runtime name audit: ${label}`, () =>
    assert.deepEqual(unexpectedNames("gateway", names), expected))

const { checkServiceEnvironments } =
  await import("./check-service-environment.mjs")
for (const runtime of [false, true])
  for (const leaked of [false, true])
    test(`name-only audit runtime=${runtime} leaked=${leaked}`, (t) => {
      const output = []
      t.mock.method(console, "log", (line) => output.push(line))
      const run = (_command, args) => {
        if (args.includes("config"))
          return JSON.stringify({
            services: {
              gateway: {
                environment: leaked
                  ? { BETTER_AUTH_SECRET: "never-print-this" }
                  : { GATEWAY_PORT: "4001" },
              },
            },
          })
        assert.ok(
          args.includes("Object.keys(process.env)") ||
            args.some((arg) => arg.includes("Object.keys(process.env)"))
        )
        assert.ok(args.includes("exec"))
        return JSON.stringify(
          leaked ? ["BETTER_AUTH_SECRET"] : ["GATEWAY_PORT", "PATH"]
        )
      }
      if (leaked)
        assert.throws(
          () => checkServiceEnvironments({ runtime, run }),
          /isolation failed/
        )
      else checkServiceEnvironments({ runtime, run })
      assert.ok(output.every((line) => !line.includes("never-print-this")))
      assert.equal(output.length, 1)
    })
