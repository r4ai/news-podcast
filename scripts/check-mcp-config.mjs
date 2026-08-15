import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))

const MCP_IMAGE =
  "grafana/mcp-grafana:1.0.0@sha256:5efeafd01cd7e1aea9c4b0f03305951f2944db8f43e5ae290cce9578c977f241"
const ENABLED_TOOLS =
  "search,datasource,prometheus,loki,alerting,dashboard,navigation,proxied"
const DEPRECATED_VENDOR_PATTERN = new RegExp(["sig", "noz"].join(""), "i")

function readRequiredFile(path) {
  assert.doesNotThrow(() => statSync(path), `Required file is missing: ${path}`)
  return readFileSync(path, "utf8")
}

function repositoryFiles(repositoryRoot) {
  const output = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { cwd: repositoryRoot }
  )

  return output.toString("utf8").split("\0").filter(Boolean)
}

function findLiveDeprecatedReferences(root) {
  return repositoryFiles(root).filter((relativePath) => {
    if (relativePath.startsWith("docs/adr/")) return false

    const absolutePath = resolve(root, relativePath)
    let content
    try {
      if (statSync(absolutePath).size > 2_000_000) return false
      content = readFileSync(absolutePath, "utf8")
    } catch {
      return false
    }

    return !content.includes("\0") && DEPRECATED_VENDOR_PATTERN.test(content)
  })
}

export function validateMcpConfiguration(root = repositoryRoot) {
  const mcpConfig = readRequiredFile(resolve(root, ".codex/config.toml"))
  const wrapper = readRequiredFile(resolve(root, "scripts/run-grafana-mcp.sh"))
  const tokenProvisioner = readRequiredFile(
    resolve(root, "scripts/ensure-grafana-mcp-token.mjs")
  )
  const tempoConfig = readRequiredFile(
    resolve(root, "infra/observability/tempo/config.yaml")
  )
  const composeConfig = readRequiredFile(
    resolve(root, "infra/observability/compose.yaml")
  )
  const datasourceConfig = readRequiredFile(
    resolve(
      root,
      "infra/observability/grafana/provisioning/datasources/datasources.yaml"
    )
  )

  assert.deepEqual(
    [...mcpConfig.matchAll(/^\[mcp_servers\.([^.\]]+)\]$/gm)].map(
      (match) => match[1]
    ),
    ["grafana"],
    "Project config must define only the Grafana MCP server"
  )
  assert.match(mcpConfig, /command = "bash"/)
  assert.match(mcpConfig, /args = \["scripts\/run-grafana-mcp\.sh"\]/)
  assert.match(wrapper, new RegExp(escapeRegExp(MCP_IMAGE)))
  assert.match(wrapper, /--network news-podcast-observability/)
  assert.match(wrapper, /-t stdio/)
  assert.match(wrapper, /--disable-write/)
  assert.match(
    wrapper,
    new RegExp(`--enabled-tools ${escapeRegExp(ENABLED_TOOLS)}`)
  )
  assert.match(wrapper, /--max-loki-log-limit 200/)
  assert.match(mcpConfig, /GRAFANA_URL = "http:\/\/grafana:3000"/)
  assert.match(mcpConfig, /env_vars = \["GRAFANA_SERVICE_ACCOUNT_TOKEN"\]/)
  assert.match(mcpConfig, /startup_timeout_sec = 20/)
  assert.match(mcpConfig, /tool_timeout_sec = 120/)
  assert.match(mcpConfig, /default_tools_approval_mode = "writes"/)
  assert.doesNotMatch(mcpConfig, DEPRECATED_VENDOR_PATTERN)
  assert.doesNotMatch(mcpConfig, /GRAFANA_API_KEY|GRAFANA_ADMIN_PASSWORD/i)
  assert.doesNotMatch(
    mcpConfig,
    /GRAFANA_SERVICE_ACCOUNT_TOKEN\s*=\s*["'][^"']+["']/
  )
  assert.match(tokenProvisioner, /role: "Viewer"/)
  assert.match(tokenProvisioner, /mode: 0o600/)
  assert.match(wrapper, /GRAFANA_SERVICE_ACCOUNT_TOKEN:-/)
  assert.match(wrapper, /\.codex\/state\/grafana-viewer-token/)
  assert.doesNotMatch(wrapper, /GRAFANA_SERVICE_ACCOUNT_TOKEN=["'][^$]/)

  assert.match(
    tempoConfig,
    /(^|\n)query_frontend:\s*\n\s+mcp_server:\s*\n\s+enabled:\s+true\b/
  )
  assert.match(composeConfig, /name:\s+news-podcast-observability\b/)
  for (const uid of ["prometheus", "loki", "tempo"]) {
    assert.match(datasourceConfig, new RegExp(`uid:\\s*${uid}\\b`))
  }

  const liveDeprecatedReferences = findLiveDeprecatedReferences(root)
  assert.deepEqual(
    liveDeprecatedReferences,
    [],
    `Deprecated observability references must remain historical ADR content only: ${liveDeprecatedReferences.join(", ")}`
  )

  return true
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  validateMcpConfiguration()
  console.log("MCP configuration is valid.")
}
