#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBSERVABILITY_DIR="$REPOSITORY_ROOT/infra/observability"
VALIDATION_STORAGE="$(mktemp -d)"
trap 'rm -rf "$VALIDATION_STORAGE"' EXIT
chmod 0777 "$VALIDATION_STORAGE"

docker run --rm \
  -v "$VALIDATION_STORAGE:/var/lib/otelcol/storage" \
  -v "$OBSERVABILITY_DIR/collector.yaml:/etc/otelcol-contrib/config.yaml:ro" \
  otel/opentelemetry-collector-contrib:0.135.0 \
  validate --config=/etc/otelcol-contrib/config.yaml

docker run --rm --entrypoint promtool \
  -v "$OBSERVABILITY_DIR/prometheus/prometheus.yaml:/etc/prometheus/prometheus.yaml:ro" \
  prom/prometheus:v3.13.1 \
  check config /etc/prometheus/prometheus.yaml

rg -U 'out_of_order_time_window:[[:space:]]+2h' \
  "$OBSERVABILITY_DIR/prometheus/prometheus.yaml" >/dev/null

docker run --rm \
  -v "$OBSERVABILITY_DIR/loki/config.yaml:/etc/loki/config.yaml:ro" \
  grafana/loki:3.7.2 \
  -config.file=/etc/loki/config.yaml -verify-config=true

docker run --rm \
  -v "$OBSERVABILITY_DIR/tempo/config.yaml:/etc/tempo/config.yaml:ro" \
  grafana/tempo:2.10.7 \
  -config.file=/etc/tempo/config.yaml -config.verify=true

for dashboard in "$OBSERVABILITY_DIR"/grafana/dashboards/*.json; do
  jq -e . "$dashboard" >/dev/null
done

expected_dashboard_uids=(
  news-podcast-overview
  news-podcast-service-map
  news-podcast-service-drilldown
  news-podcast-logs
  news-podcast-episode
  news-podcast-web
  news-podcast-dependencies
  news-podcast-platform
)
for uid in "${expected_dashboard_uids[@]}"; do
  dashboard="$OBSERVABILITY_DIR/grafana/dashboards/${uid#news-podcast-}.json"
  case "$uid" in
    news-podcast-overview) dashboard="$OBSERVABILITY_DIR/grafana/dashboards/overview.json" ;;
    news-podcast-service-map) dashboard="$OBSERVABILITY_DIR/grafana/dashboards/service-map.json" ;;
    news-podcast-service-drilldown) dashboard="$OBSERVABILITY_DIR/grafana/dashboards/service-drilldown.json" ;;
    news-podcast-logs) dashboard="$OBSERVABILITY_DIR/grafana/dashboards/logs.json" ;;
    news-podcast-episode) dashboard="$OBSERVABILITY_DIR/grafana/dashboards/episode-production.json" ;;
    news-podcast-web) dashboard="$OBSERVABILITY_DIR/grafana/dashboards/web-experience.json" ;;
    news-podcast-dependencies) dashboard="$OBSERVABILITY_DIR/grafana/dashboards/dependencies.json" ;;
    news-podcast-platform) dashboard="$OBSERVABILITY_DIR/grafana/dashboards/telemetry-platform.json" ;;
  esac
  jq -e --arg uid "$uid" '.uid == $uid' "$dashboard" >/dev/null
done

if rg -n 'http_server_error_total|provider_request_duration_bucket|episode_stage_oldest_age|episode_checkpoint_total|episode_lease_(lost|recovered|expired)_total|system_filesystem_utilization' \
  "$OBSERVABILITY_DIR/grafana" >/dev/null; then
  echo "Dashboard or alert references an unverified metric." >&2
  exit 1
fi

docker compose -f "$OBSERVABILITY_DIR/compose.yaml" config --quiet
docker compose \
  -f "$REPOSITORY_ROOT/compose.yaml" \
  -f "$REPOSITORY_ROOT/compose.observability.yaml" \
  config --quiet

base_compose_json="$(
  docker compose -f "$OBSERVABILITY_DIR/compose.yaml" config --format json
)"
jq -e '
  .services["otel-collector"].volumes
    | all(.source != "/")
' <<<"$base_compose_json" >/dev/null
jq -e '
  .services["otel-collector"].volumes
    | any(.target == "/var/lib/otelcol/storage" and .type == "volume")
' <<<"$base_compose_json" >/dev/null
if rg -n 'hostmetrics|root_path:[[:space:]]*/hostfs' \
  "$OBSERVABILITY_DIR/collector.yaml" >/dev/null; then
  echo "Host metrics must run outside the public OTLP Collector." >&2
  exit 1
fi

gateway_compose_json="$(
  GRAFANA_ADMIN_PASSWORD=validation-only \
  OTLP_DOMAIN=otel.example.invalid \
  TELEMETRY_PROXY_TOKEN=validation-only \
  WATCHDOG_SMTP_HOST=smtp.example.invalid \
  WATCHDOG_SMTP_USERNAME=validation-only \
  WATCHDOG_SMTP_PASSWORD=validation-only \
  WATCHDOG_SMTP_FROM=watchdog@example.invalid \
  WATCHDOG_SMTP_TO=oncall@example.invalid \
    docker compose \
      -f "$OBSERVABILITY_DIR/compose.yaml" \
      -f "$OBSERVABILITY_DIR/compose.gateway.yaml" \
      config --format json
)"
jq -e '
  .services["otlp-ingress"].ports
    | any(.target == 443 and .published == "443")
' <<<"$gateway_compose_json" >/dev/null
jq -e '
  (.services.watchdog.depends_on // {})
    | has("otel-collector") == false and has("grafana") == false
' <<<"$gateway_compose_json" >/dev/null

for exporter in otlp/tempo otlphttp/loki; do
  rg -U "${exporter}:[\\s\\S]*?storage: file_storage/queue" \
    "$OBSERVABILITY_DIR/collector.yaml" >/dev/null
done
rg -U 'prometheusremotewrite:[\s\S]*?wal:[\s\S]*?directory: /var/lib/otelcol/storage/' \
  "$OBSERVABILITY_DIR/collector.yaml" >/dev/null
if rg -n -U 'resource_to_telemetry_conversion:[[:space:]]*\n[[:space:]]+enabled: true' \
  "$OBSERVABILITY_DIR/collector.yaml" >/dev/null; then
  echo "All resource attributes must not be converted to metric labels." >&2
  exit 1
fi
rg -F 'keep_keys(resource.attributes, ["service.name", "service.version", "deployment.environment.name", "telemetry.schema.version", "telemetry.backend"])' \
  "$OBSERVABILITY_DIR/collector.yaml" >/dev/null

echo "Observability configuration is valid."
