# Self-hosted observability

SigNoz本体はFoundryで生成し、外部公開はこのdirectoryのOTLP ingressだけに限定する。

```bash
cd infra/observability
foundryctl gauge -f casting.yaml
foundryctl forge -f casting.yaml
foundryctl cast -f casting.yaml
OTLP_DOMAIN=otel.example.com TELEMETRY_PROXY_TOKEN=... docker compose -f compose.gateway.yaml up -d
```

Host firewallでは443だけを公開し、4317、4318、8080、ClickHouse/Postgresのportを閉じる。SigNoz UIはVPNまたはSSH tunnelから利用する。TLS certificateは`/etc/letsencrypt/live/$OTLP_DOMAIN`へ配置する。

SigNoz Settingsでlogs 30日、traces 15日、metrics 180日に設定する。SMTP contact pointを作り、`alerts/rules.yaml`の発火・復旧条件を登録する。dashboardとalertのJSON/API schemaはSigNoz releaseに追従するため、稼働instanceからexportしたartifactを受け入れ証拠として管理する。

Cloudflare Dashboardでは`self-hosted-traces`と`self-hosted-logs`のdestinationを作成し、endpointとBearer tokenをsecretとして登録する。Wranglerにはdestination名とsampling/persist方針だけを置く。
