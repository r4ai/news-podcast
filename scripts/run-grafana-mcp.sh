#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
token_file="$repository_root/.codex/state/grafana-viewer-token"

node "$repository_root/scripts/ensure-grafana-mcp-token.mjs" >&2

grafana_token="${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}"
if [[ -z "$grafana_token" ]]; then
  if [[ ! -r "$token_file" ]]; then
    echo "Grafana MCP token is missing: $token_file" >&2
    exit 1
  fi
  grafana_token="$(<"$token_file")"
fi

exec docker run --rm -i \
  --network news-podcast-observability \
  --env GRAFANA_URL="${GRAFANA_URL:-http://grafana:3000}" \
  --env GRAFANA_SERVICE_ACCOUNT_TOKEN="$grafana_token" \
  grafana/mcp-grafana:1.0.0@sha256:5efeafd01cd7e1aea9c4b0f03305951f2944db8f43e5ae290cce9578c977f241 \
  -t stdio \
  --disable-write \
  --enabled-tools search,datasource,prometheus,loki,alerting,dashboard,navigation,proxied \
  --max-loki-log-limit 200
