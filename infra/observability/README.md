# Self-hosted observability

SigNoz本体はFoundryで生成し、外部公開はこのdirectoryのOTLP ingressだけに限定する。Dashboard、alert rule、routing policyの正本は`terraform/`であり、UIでの手作業変更は禁止する。

```bash
cd infra/observability
foundryctl gauge -f casting.yaml
foundryctl forge -f casting.yaml
foundryctl cast -f casting.yaml
docker compose -f pours/deployment/compose.yaml -f compose.smtp.yaml up -d
OTLP_DOMAIN=otel.example.com TELEMETRY_PROXY_TOKEN=... \
  WATCHDOG_SMTP_HOST=... WATCHDOG_SMTP_USERNAME=... WATCHDOG_SMTP_PASSWORD=... \
  WATCHDOG_SMTP_FROM=... WATCHDOG_SMTP_TO=... \
  docker compose -f compose.gateway.yaml up -d
```

Host firewallでは443だけを公開し、4317、4318、8080、ClickHouse/Postgresのportを閉じる。SigNoz UIはVPNまたはSSH tunnelから利用する。TLS certificateは`/etc/letsencrypt/live/$OTLP_DOMAIN`へ配置する。

SMTP server設定は`compose.smtp.yaml`へsecret環境変数で渡す。公式provider v0.1.0はnotification channel resourceをまだ持たないため、channelだけを公式APIで冪等bootstrapし、それ以外をTerraformで管理する。

```bash
export SIGNOZ_ENDPOINT=https://signoz.example.com
export SIGNOZ_ACCESS_TOKEN=... # Admin service account key
export SIGNOZ_SMTP_TO=oncall@example.com
node bootstrap-smtp-channel.mjs

terraform -chdir=terraform init
terraform -chdir=terraform fmt -check
terraform -chdir=terraform validate
terraform -chdir=terraform plan -out=signoz.tfplan
terraform -chdir=terraform apply signoz.tfplan
```

`SIGNOZ_ACCESS_TOKEN`、SMTP password、宛先はrepository・tfvars・stateへ保存しない。channelは`send_resolved=true`、critical ruleは1分ごとに評価し、firing中は30分ごとに再通知する。Generation dashboardはservice、environment、version、stage filter、source/grain/freshness、100%収集されたWorker traceへの導線を持つ。

watchdogはSigNozと同じホスト上の独立processで、API、Worker、VOICEVOX、SigNoz、Collector exporterの進捗を60秒ごとに確認する。異常はSigNozを経由せずSMTPへ直接送り、30分再通知と復旧通知を行う。状態は`watchdog-data` volumeに保存する。ホスト全停止とネットワーク全断はこの構成では通知できないため、別ホスト監視を追加するまで残余リスクとして扱う。

適用後は次を合格証拠として保存する。

1. synthetic counterで全ruleが2分以内に発火し、SMTP受信・30分再通知・復旧通知を確認する。
2. SigNoz containerを停止し、watchdogから直接メールが届くことを確認する。
3. 各panel値を同時間窓のMetrics Explorerと照合し、filterとtrace linkを確認する。
4. logs 30日、traces 15日、metrics 180日のretentionと、ClickHouse backup/restoreを確認する。

rollbackはTerraformの直前commitをcheckoutして再度`plan/apply`する。DB migrationを伴うリリースでは先にSQLite backupを取得し、短時間Workerを止め、`PRAGMA integrity_check`とsynthetic長時間生成を確認してから再開する。migration後DBを旧binaryで開かず、rollback時はbackup DBと旧binaryを対で戻す。

Cloudflare Dashboardでは`self-hosted-traces`と`self-hosted-logs`のdestinationを作成し、endpointとBearer tokenをsecretとして登録する。Wranglerにはdestination名とsampling/persist方針だけを置く。
