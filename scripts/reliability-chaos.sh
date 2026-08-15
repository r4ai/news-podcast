#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_name="news-podcast-reliability-chaos"
compose=(docker compose --project-name "$project_name" --file "$repository_root/compose.yaml" --file "$repository_root/infra/reliability/compose.yaml")

cleanup() {
  status=$?
  if (( status != 0 )); then
    mkdir -p "$repository_root/artifacts/reliability-chaos"
    "${compose[@]}" logs --no-color >"$repository_root/artifacts/reliability-chaos/compose.log" 2>&1 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans
  exit "$status"
}
trap cleanup EXIT

wait_healthy() {
  service="$1"
  deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    container_id="$("${compose[@]}" ps --quiet "$service")"
    if [[ -n "$container_id" ]] && [[ "$(docker inspect "$container_id" --format '{{.State.Health.Status}}' 2>/dev/null)" == "healthy" ]]; then
      return 0
    fi
    sleep 2
  done
  echo "$service did not return healthy within 180 seconds" >&2
  return 1
}

wait_restarted() {
  service="$1"
  before="$2"
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    container_id="$("${compose[@]}" ps --all --quiet "$service")"
    if [[ -n "$container_id" ]] && (( $(docker inspect "$container_id" --format '{{.RestartCount}}') > before )); then
      return 0
    fi
    sleep 1
  done
  echo "$service did not restart after the terminal failure" >&2
  return 1
}

crash_node_service() {
  container_id="$1"
  docker exec "$container_id" node -e '
    const fs = require("node:fs");
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
      try {
        const command = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ");
        if (command.includes("tsx/dist/preflight.cjs") && command.includes("src/bootstrap.ts")) {
          process.kill(Number(entry), "SIGKILL");
          process.exit(0);
        }
      } catch {}
    }
    process.exit(2);
  '
}

"${compose[@]}" up --detach --build --wait

for service in identity-access content-knowledge episode-production episode-library; do
  container_id="$("${compose[@]}" ps --quiet "$service")"
  before="$(docker inspect "$container_id" --format '{{.RestartCount}}')"
  crash_node_service "$container_id"
  wait_healthy "$service"
  container_id="$("${compose[@]}" ps --quiet "$service")"
  after="$(docker inspect "$container_id" --format '{{.RestartCount}}')"
  if (( after <= before )); then
    echo "$service was not automatically restarted" >&2
    exit 1
  fi
  "${compose[@]}" exec -T gateway node -e \
    "fetch('http://127.0.0.1:4001/api/auth/state').then(r=>{if(!r.ok)throw new Error('RPC probe '+r.status);return r.json()}).then(v=>{if(v.authenticated!==false)throw new Error('unexpected session')})"
done

declare -A restart_counts
for service in identity-access content-knowledge episode-production episode-library gateway; do
  container_id="$("${compose[@]}" ps --quiet "$service")"
  restart_counts[$service]="$(docker inspect "$container_id" --format '{{.RestartCount}}')"
done
"${compose[@]}" stop nats
for service in identity-access content-knowledge episode-production episode-library gateway; do
  wait_restarted "$service" "${restart_counts[$service]}"
done
"${compose[@]}" start nats
wait_healthy nats
for service in identity-access content-knowledge episode-production episode-library gateway; do
  wait_healthy "$service"
done

for pair in \
  "identity-access:/app/data/identity.sqlite" \
  "content-knowledge:/app/data/content.sqlite" \
  "episode-production:/app/data/production.sqlite" \
  "episode-library:/app/data/library.sqlite"; do
  service="${pair%%:*}"
  database="${pair#*:}"
  "${compose[@]}" exec -T "$service" node -e \
    "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('$database',{readOnly:true});const row=db.prepare('PRAGMA quick_check').get();if(row.quick_check!=='ok')process.exit(1);db.close()"
done

"${compose[@]}" run --rm nats-provision nats --server nats://nats:4222 stream info EPISODE_PRODUCTION >/dev/null
echo "Reliability chaos checks passed."
