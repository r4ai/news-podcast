# 開発ガイド

このガイドは、唯一のruntimeであるNode self-host構成をローカルで起動・検証する手順を示す。正本はGatewayと4 Context servicesである。

## クイックスタート

### 必要なもの

| ツール | バージョン | 用途 |
| --- | --- | --- |
| Node.js | 24以上 | build、test、migration |
| pnpm | 11.16.0 | workspace管理 |
| Docker Compose | 現行版 | Gateway、4 services、NATS、SeaweedFS、VOICEVOX、Web |

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm setup:env
pnpm dev:up
```

`pnpm setup:env`は`.env`がない場合だけ`.env.example`から作成し、開発用secretを生成する。既存`.env`は更新しないため、項目追加時は手動で差分を反映する。

| 接続先 | URL |
| --- | --- |
| Web | <http://localhost:4173> |
| Gateway health | <http://localhost:4001/health> |
| NATS monitoring | <http://localhost:8222> |
| SeaweedFS S3 | <http://localhost:8333> |
| VOICEVOX | <http://localhost:50021> |

テスト用サーバーは通常構成とポートを共有しない。ローカルとCIは同じ既定値を使い、並列実行時だけ環境変数で上書きする。

| テストサーバー | 既定ポート | 上書き |
| --- | ---: | --- |
| Web E2E fake API | 3310 | `E2E_API_PORT` |
| Web E2E Vite | 4273 | `E2E_WEB_PORT` |
| Web Vitals fake API | 4100 | `PERF_API_PORT` |
| Web Vitals preview | 4473 | `PERF_WEB_PORT` |

開発ログインは`.env`の`DEV_AUTH_PASSWORD`を使う。`APP_ENV=production`では開発ログインとfake providerを有効にできない。Content KnowledgeとEpisode Productionは同じprovider mode parserを使い、次の状態遷移をReady前に検証する。

| `APP_ENV` | `PROVIDER_MODE` | 必須設定 | 起動結果 |
| --- | --- | --- | --- |
| `development` / `test` | `fake`（未指定時の既定） | 各serviceのlocal依存 | 起動 |
| `development` / `test` | `live` | OpenAI key/modelと各service依存 | 起動 |
| `production` | `live` | OpenAI key/modelと各service依存 | 起動 |
| `production` | 未指定 / `fake` / 未知値 / 大文字違い | — | 起動拒否 |
| 未知の`APP_ENV` | 任意 | — | 起動拒否 |

成功した構成は`provider.configuration` log/metricへ`app.env`と`provider.mode`だけを記録し、secretは属性に含めない。詳細は[ADR-0077](adr/0077-fail-closed-production-provider-mode.md)を参照する。

終了時はvolumeを残して停止する。

```bash
pnpm dev:down
```

`docker compose down --volumes`はservice DB、NATS、objectを削除するため、初期化する意図がある場合だけ実行する。

## supported topology

```mermaid
flowchart LR
  Browser["Browser :4173"] --> Edge["Nginx static + reverse proxy"]
  Edge --> Web["React assets"]
  Edge --> Gateway["Effect Gateway :4001"]
  Gateway -->|"auth HTTP proxy"| Identity["Identity Access"]
  Gateway <-->|"versioned NATS RPC"| Identity
  Gateway <-->|"versioned NATS RPC"| Content["Content Knowledge"]
  Gateway <-->|"versioned NATS RPC"| Production["Episode Production"]
  Gateway <-->|"versioned NATS RPC"| Library["Episode Library"]
  Production -->|"durable completion"| Library
  Content --> S3[("SeaweedFS S3")]
  Production --> S3
  Library --> S3
  Content --> OpenAI["OpenAI via Effect AI"]
  Production --> OpenAI
  Production --> Voicevox["VOICEVOX"]
```

各Contextは専用SQLiteを所有する。Context間でDBを共有せず、同期query/commandはNATS RPC、確実な完成通知はProductionからLibraryへのJetStreamだけを使う。Contentの記事参照はRPCが正本で、未使用のContent Outbox/eventは持たない。

| service | health port | state |
| --- | ---: | --- |
| Gateway | 4101 | 業務stateなし |
| Identity Access | 4102 | identity SQLite |
| Content Knowledge | 4103 | content SQLite |
| Episode Production | 4104 | production SQLite |
| Episode Library | 4105 | library SQLite |

NATSだけを確認する場合:

```bash
docker compose up -d nats
curl --fail --silent --show-error \
  'http://127.0.0.1:8222/healthz?js-enabled-only=true'
```

host上でserviceを直接起動する場合は`NATS_SERVERS=nats://127.0.0.1:4222`を使う。Compose内は`nats://nats:4222`である。

## 開発シナリオ

### Webをhostでhot reloadする

```bash
docker compose up -d --build gateway identity-access content-knowledge episode-production episode-library nats-provision seaweedfs voicevox
VITE_API_PROXY_TARGET=http://localhost:4001 pnpm --filter web dev
```

Webの`/api`と`/v1`はGatewayだけへproxyする。認証routeもGatewayが固定originのIdentity HTTPへ転送する。

### 外部APIなしで検証する

`.env`の既定値は`APP_ENV=development`かつ`PROVIDER_MODE=fake`である。固定providerを使って認証、購読、記事、非同期job、Library、音声accessを確認できる。未知値はfakeへ読み替えず設定エラーになる。

```bash
pnpm test:e2e:functional
pnpm test:e2e
```

functional E2Eは実NATS/JetStreamを使うbackend縦断、Web E2Eは分離したfake stackを使う主要journeyである。外部API keyや課金requestは不要である。

### OpenAIとVOICEVOXを使う

```dotenv
APP_ENV=development
PROVIDER_MODE=live
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-5.6-luna
```

```bash
pnpm dev:up # telemetryなし
pnpm dev:up:observed # 同じlive providerをGrafanaで観測
```

VOICEVOXへの長文入力は、音声推論のpeak memoryを抑えるため既定で200文字ごとに逐次合成する。`VOICEVOX_MAXIMUM_TEXT_CHARACTERS`を増やす場合は、実際の台本長でVOICEVOXコンテナのpeak memoryを確認すること。VOICEVOXは一時的なprocess停止やOOM後にComposeが再起動し、Episode Productionの有界retryが回復後の処理を引き継ぐ。

本番生成はownerが選択しContentが版固定した記事だけを入力にする。Content KnowledgeとEpisode Productionは共通の`packages/ai-runtime`を通じてEffect AIの`LanguageModel.generateObject`を使い、strict structured output、request deadline、応答byte上限、一時障害だけの有界retryを適用する。hosted Web検索と一般Agent Harnessは本番経路へ接続しない（[ADR-0057](adr/0057-effect-ai-as-llm-boundary.md)）。

起動済みlive stackをOpenAPIからブラウザ操作し、実際の記事選択、OpenAI台本生成、VOICEVOX音声合成、durable AG-UI replay、Libraryでの再生まで検証する場合は、明示的に環境変数を読み込んで次を実行する。これはOpenAIへの課金requestを発生させる。

```bash
set -a
. ./.env
set +a
pnpm test:e2e:live
```

進捗wire契約、`Last-Event-ID`、標準eventとtransport拡張の境界は[Episode Job進捗プロトコル](protocols/episode-job-ag-ui.md)を正本とする。

## OpenAPI契約

`apps/gateway/src/contract.ts`が外部HTTP契約の正本である。生成物は`packages/contracts/openapi/openapi.json`と`packages/contracts/src/generated/openapi.ts`へ保存し、Webが利用する。Gatewayは同じ契約から生成したOpenAPI文書を`/openapi.json`、Scalar API Referenceを`/docs`で公開する。

```mermaid
flowchart LR
  Contract["Gateway Effect HttpApi"] --> Generate["contract:generate"]
  Generate --> Json["OpenAPI JSON"]
  Generate --> Types["TypeScript types"]
  Types --> Web["Web client"]
  Json --> Scalar["Scalar /docs"]
```

```bash
pnpm contract:generate
pnpm contract:check
pnpm contract:lint
```

`pnpm dev:up`または`pnpm dev:up:observed`の起動後、ブラウザ向けの正規入口は <http://localhost:4173> だけである。Scalarは <http://localhost:4173/docs>、OpenAPI JSONは <http://localhost:4173/openapi.json> で確認できる。`4001`はGateway単体診断用にlocalhostへ限定公開する。

契約変更では生成物を同じ変更に含め、`contract:check`で差分がないことを確認する。Better Authの`/api/auth/**`は認証provider側の契約で、アプリOpenAPIへ複製しない。

外部provider DTOを変更する前に[外部provider契約台帳](external-provider-contracts.md)を更新する。通常CIは`pnpm provider-contract:check`だけを実行する。live refreshは資格情報とlocal providerを必要とする明示操作であり、`PROVIDER_CONTRACT_REFRESH=1 pnpm provider-contract:refresh`のpreflight後に行う。OpenAIは同じ環境で各serviceの`*.contract.test.ts`を実行し、`OPENAI_CONTRACT_SAMPLES`（既定3、最大25/adapter）で実リクエスト数を制御する。model変更は[移行手順](operations/openai-model-migration.md)に従う。

## 品質gate

GitHub Actionsではローカルの品質gateを`CI / static`、`CI / unit`、`CI / web-e2e`、`CI / visual`、`CI / functional-e2e`、`CI / observability`へ分割して実行する。PRを作成する前に少なくとも次を実行する。

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:e2e:functional
pnpm test:visual
pnpm observability:validate
pnpm audit --audit-level=high
```

`CI / security`は別workflowで、ActionのSHA固定、workflow lint、zizmor、Gitleaks、依存脆弱性を検査する。PRコードを実行しないため、ローカルのセキュリティ検査結果と通常CIの結果を混同しない。運用、pinactの更新、GitHub settingsは[CIとサプライチェーン防御](ci.md)を参照する。

| コマンド | 検証内容 |
| --- | --- |
| `pnpm format:check` | oxfmt差分 |
| `pnpm lint` | oxlint、Spectral、architecture gate、structured parser gate |
| `pnpm typecheck` | workspace型検査 |
| `pnpm test` | unit/integration tests |
| `pnpm test:coverage:functional` | 8 functional packagesのlines 75% / branches 60% |
| `pnpm test:coverage:reliability` | 共通Supervisor/NATS loopのlines/branches 90%以上 |
| `pnpm test:e2e:functional` | Gateway→4 services、NATS/JetStream縦断 |
| `pnpm test:e2e:live` | 起動済みlive stackのOpenAPI・画面生成・AG-UI再開・音声再生（課金あり） |
| `pnpm provider-contract:check` | 匿名化した外部契約fixtureのoffline検査 |
| `pnpm test:e2e` | Web主要journey |
| `pnpm test:sqlite-state` | service別backup/restore拒否規則 |
| `pnpm db:generate` | drizzle schemaからmigration SQLを生成（要レビュー） |
| `pnpm observability:validate` | LGTM構文、Dashboard UID、未確認metric参照 |
| `pnpm observability:smoke` | 起動後のGrafana API、datasource、Collector、Browser OTLP、依存endpoint |
| `pnpm test:visual` | 視覚回帰とaxe。Playwright公式コンテナの中で実行する |
| `pnpm reliability:chaos` | 隔離Composeで4 service/NATSを停止し、自動再起動・Ready・state整合性を検査 |

bug修正は再現testを先に追加する。LLM接続ではsuccessだけでなく、timeout、429/5xx、invalid schema、response上限、non-retryable failureをprovider境界で確認する。

### 視覚回帰(VRT)

スナップショットの比較はピクセル単位なので、フォントとラスタライザが1つでも違えば同じページでも別の絵になる。**VRTは常にPlaywright公式コンテナの中で実行する**。`pnpm test:visual`も`pnpm --filter web test:visual`も`scripts/run-visual.sh`を通り、CIは同じイメージをjobのcontainerとして使う。イメージはdigestで固定し、`apps/web`の`@playwright/test`と同じversionを指す。

```bash
pnpm test:visual                            # 比較する
pnpm test:visual -- --update-snapshots=all  # 基準画像を作り直す
```

dockerが無い環境では実行できない。撮り方を変えるより、環境を揃える方が壊れにくいという判断である。

長いページは行ボックスの丸めで全体の高さが実行ごとに1px動くことがあり、寸法が違うと`maxDiffPixelRatio`は効かずに失敗する。記事リーダーだけはviewport固定で撮る。また、非同期に差し替わる本文(remark/rehype + Shiki)は、題名ではなく本文の最後に出る要素を待ってから撮る。

### フロントエンドの性能計測

計測は**本番ビルド**に対して行う。dev serverは変換とHMR clientの分だけ実態から離れる。`scripts/run-fake-preview.ts`が`vite build` → `vite preview`と偽Gatewayを起動し、Playwrightがそこを測る。

```bash
pnpm --filter web perf:vitals   # FCP/LCP/CLS/INPを実測する
pnpm --filter web build         # bundle計測にはmanifest付きproduction buildが必須
pnpm --filter web perf:bundle   # 初期ロードと主要routeのgzip予算をblocking検査
```

条件はCPU 4倍抑制、Slow 4G相当(1.6 Mbps / 150 ms)、**キャッシュが空のcontext**での初回訪問に固定してある。抑制しないと開発機の速さとlocalhostの帯域が差を潰し、バンドルを削っても数字が動かない。ログイン後のページ内遷移を測るのも同じ理由で無意味になる。

タイミングの値は実行環境で揺れるのでCIでは`web-e2e` job内の非ブロッキングstepとして計測する。決定的な`perf:bundle`はrequiredな`static` jobでブロックする。`dist`またはmanifestが無い単独実行は、先にbuildするコマンドを示して失敗する。

予算は`scripts/bundle-budgets.ts`でbaseline、上限、変更理由を一組として管理する。初期ロードは`index.html`の資産、主要routeはVite manifestから静的依存を再帰的に集め、初期資産との重複を除いて測る。CI summaryのbaseline→current差と残量を確認し、上限変更時は実測差と理由を同じdiffへ残す。

「どのcomponentが何回描かれたか」はVitestで予算にする。`shared/test/render-count`の`watchRenders`で実物のcomponentを`vi.mock`から包み、操作前後の差を数える。production側へ計測用のコードは入れない。詳細は[ADR-0060](adr/0060-atom-scoped-rendering-and-measured-frontend-budgets.md)。

### 構造化入力のparser方針

RSS/Atom、HTML、Markdownの文書構造は正規表現で解釈しない。専用parserでASTまたは構造化データへ変換し、sanitize・正規化・serializeを別段階に分ける。

```mermaid
flowchart LR
  Input["untrusted XML / HTML / Markdown"] --> Limit["byte / timeout / resource limit"]
  Limit --> Parser["named parser / AST"]
  Parser --> Transform["sanitize + domain normalization"]
  Transform --> Output["typed data / Markdown / replay"]
  Gate["pnpm parser:check"] -.-> Parser
```

現在のContent境界は、RSS/Atomに`fast-xml-parser`、記事HTML→Markdownにscript/resource無効の`jsdom`、Readability、rehype/remarkを使う。Site Profileはroot/selector/意味対応だけを宣言し、code/callout/embed/mathは共有Ruleで変換する。記事変換には入力1 MiB、ASTノード5万、深さ128、Markdown出力1 MiBの上限を設け、上限超過は`ResourceLimit`として保存前に拒否する。正規表現はURL・固定語彙などの字句検証に限定し、構造解釈へ戻さない。詳細は[ADR-0042](adr/0042-structured-input-parser-boundaries.md)と[ADR-0051](adr/0051-extensible-article-markdown-conversion.md)を参照する。

記事変換の固定corpusと100% scoped coverageは`pnpm --filter @news-podcast/content-knowledge test:article-markdown:coverage`、renderer純粋関数は`pnpm --filter web test:markdown:coverage`で検証する。実サイトの任意smokeは通常CIから分離し、`pnpm --filter @news-podcast/content-knowledge test:article-markdown:live`で実行する。

変換器が実際に出力したMarkdownは、`pnpm markdown:corpus`で`apps/web/src/shared/markdown/__fixtures__/`へ書き出してcommitする（`apps/web`は`services/**`をimportできないため、橋渡しは生成物で行う）。変換器やfixtureを触ったらこれを再実行すること。CIは`pnpm markdown:corpus:check`で同期を検査し、描画結果は`corpus.test.tsx`とStorybookの`Markdown/Corpus`で確認する（[ADR-0053](adr/0053-markdown-corpus-bridges-converter-and-renderer.md)）。

```bash
pnpm parser:check
```

## State backupと復旧

4 SQLiteをwrite barrierで同じlogical cutへ固定し、SeaweedFS inventoryとProduction/Library横断不変条件を束ねる自動backup、週次restore drill、別pathへの検証restore、offline cutover、rollbackは[Coordinated service state backup / restore](operations/service-state-recovery.md)を正本とする。既存DBへの上書きと別serviceのbackup復元はCLIが拒否する。

## Observability

```bash
pnpm dev:up:observed
pnpm observability:validate
pnpm observability:smoke
```

observed構成のserviceを再build・再起動するときも、必ずbaseとobservabilityの両Compose fileを指定する。baseだけで`--force-recreate`するとserviceがobservability networkから外れ、`OTEL_ENABLED=true`でもtelemetryが到達しない。

```bash
docker compose -f compose.yaml -f compose.observability.yaml \
  up -d --build --force-recreate episode-production
pnpm observability:smoke
```

Grafanaは<http://localhost:3100>。DashboardはOverview、Service Map、Service Drilldown、Logs、Episode、Web、Dependencies、Platformの8つを自動provisionする。障害時は`Alert → Overview → Service Drilldown → Service Map → Tempo trace → 同じtrace_idのLoki log → Prometheus metric/exemplar`の順に追う。default `OTEL_ENABLED=false`ではno-op adapterを使い、Collector障害で業務処理を止めない。

BrowserのOTLPはWebの相対URLからGatewayへ転送され、GatewayがCollectorの`/v1/traces`、`/v1/logs`、`/v1/metrics`へ固定マッピングする。Collector originをBrowserへ公開しない。Gatewayのproxyにはrequest/response byte上限とtimeoutを設定する。

observed stackはprovider設定を変更せず、`.env`を通常stackと同じように継承する。`PROVIDER_MODE=live`ではOpenAI API利用料金が発生し、`fake`では外部OpenAI APIへ接続しない（[ADR-0047](adr/0047-observed-stack-inherits-provider-mode.md)）。初期paintのWeb Vitalを収集するため、Browser SDKはアプリ描画前に開始する。

### CodexからGrafana MCPを使う

このリポジトリは、trusted project用の`.codex/config.toml`から公式の
`grafana/mcp-grafana`をDockerのstdio transportで起動する。ローカルではobserved stack起動時に
Viewer Service Account/tokenを冪等作成し、`.codex/state/grafana-viewer-token`へ`0600`で保存する。
既存tokenは検証して再利用し、失効時だけ再発行する。

```bash
pnpm dev:up:observed
pnpm mcp:check
codex mcp list
codex mcp get grafana
```

wrapperは`GRAFANA_SERVICE_ACCOUNT_TOKEN`をtoken fileより優先するため、本番では明示secretを
注入する。tokenなし、Grafana未起動、401は原因別に停止する。Service AccountはViewerに限定し、
Grafana管理者password、API key、tokenの実値をリポジトリへ保存しない。MCP server側の
`--disable-write`とtool allowlistにより、dashboard、folder、alert、annotationなどの変更操作は
許可しない。

Tempo MCPはTempo configで有効化され、stdio起動時にGrafana datasource proxyから
TraceQL検索・trace取得toolをdiscoverする。Tempoのtrace、Lokiのlog、Prometheusのmetric
はCodexのモデルコンテキストへ渡り得るため、組織のprivacy方針に従い、機密情報をtrace
属性やlogへ記録しない。TempoまたはMCP設定を変更した場合はobserved stackとCodexを
再起動する。MCPはGrafanaへ設定を書き込まず、dashboard・datasource・alertの正本は
`infra/observability`のprovisioning fileである（[ADR-0048](adr/0048-grafana-mcp-observability.md)）。

`pnpm dev:up:observed`をremote host上で実行している場合、以下のワンライナーで公開している全portをlocalへforwardできる。

```bash
ssh -N user@remote-host \
  -L 4001:localhost:4001 -L 4101:localhost:4101 \
  -L 4173:localhost:4173 \
  -L 4222:localhost:4222 -L 8222:localhost:8222 \
  -L 8333:localhost:8333 -L 9333:localhost:9333 \
  -L 50021:localhost:50021 \
  -L 4317:localhost:4317 -L 4318:localhost:4318 -L 8888:localhost:8888 \
  -L 9090:localhost:9090 \
  -L 3100:localhost:3100
```

```mermaid
flowchart LR
  Services["Gateway + 4 services"] -->|"OTLP"| Collector["OTel Collector"]
  Collector --> Prometheus
  Collector --> Tempo
  Collector --> Loki
  Prometheus --> Grafana
  Tempo --> Grafana
  Loki --> Grafana
```

## 主な環境変数

全項目と既定値は`.env.example`を正本とする。

| 領域 | 主な変数 |
| --- | --- |
| runtime | `APP_ENV`、`PROVIDER_MODE`、`NATS_SERVERS`、`CONTENT_ENRICH_RESET_ENABLED` |
| auth | `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`DEV_AUTH_*`、`GOOGLE_CLIENT_*` |
| Gateway/Identity HTTP | `GATEWAY_PORT`、`IDENTITY_HTTP_ORIGIN`、`AUTH_PROXY_*` |
| service DB | `IDENTITY_DATABASE_PATH`、`CONTENT_KNOWLEDGE_DATABASE_PATH`、`EPISODE_PRODUCTION_DATABASE_PATH`、`EPISODE_LIBRARY_DATABASE_PATH` |
| LLM | `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_REQUEST_TIMEOUT_MS`、`PROVIDER_*` |
| storage/TTS | `S3_*`、`CONTENT_ARCHIVE_*`、`VOICEVOX_*` |
| scheduler | `EPISODE_SCHEDULER_INTERVAL_MS`、`EPISODE_SCHEDULER_FAILURE_BACKOFF_MS`、`EPISODE_SCHEDULER_REQUEST_TIMEOUT_MS` |

secretをGitへ追加しない。`DEV_AUTH_ENABLED=true`と`APP_ENV=production`の組み合わせは起動時に拒否する。日次補完枠のresetは既定で無効であり、非productionで`CONTENT_ENRICH_RESET_ENABLED=true`を明示した場合だけowner自身の枠に許可する。productionとの組み合わせは設定事故として起動時に拒否する。

## トラブルシューティング

```bash
docker compose config
docker compose ps
docker compose logs gateway identity-access content-knowledge episode-production episode-library
```

| 症状 | 確認 |
| --- | --- |
| 開発ログイン失敗 | `DEV_AUTH_ENABLED`、password、Identity/Gateway log |
| Gateway 503 | 対象service readiness、NATS、RPC timeout |
| serviceが再起動する | `docker compose ps`のrestart count、terminal Cause、named readiness |
| watchdog通知 | `/metrics`の対象別up/連続失敗/最終成功、SMTP設定の完全性 |
| Grafana MCP停止 | Grafana起動、環境token、`.codex/state/grafana-viewer-token`、401 |
| 生成が進まない | Production log、OpenAI/VOICEVOX、lease/scheduler設定 |
| 番組がLibraryへ出ない | JetStream stream/consumer、Production outbox、Library inbox |
| Webだけ接続失敗 | `VITE_API_PROXY_TARGET=http://localhost:4001` |

## 関連ドキュメント

- [システムアーキテクチャ](architecture.md)
- [関数型DDD移行ガイド](functional-ddd-migration.md)
- [Service state backup / restore](operations/service-state-recovery.md)
- [品質ベースライン](quality-baseline.md)
- [負荷テストとProvider Chaos](operations/load-testing.md)
- [Architecture Decision Records](adr/)
