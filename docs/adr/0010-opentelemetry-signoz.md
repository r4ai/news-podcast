# ADR-0010: OpenTelemetryとSigNozを監視基盤に採用する

- Status: Accepted
- Date: 2026-08-10
- Decision owners: Product owner / Platform
- Supersedes: N/A
- Superseded by: ADR-0032
- Related: ADR-0017、`packages/observability`、`infra/observability`

## コンテキストと変更契機

Cloudflareへ配備するWeb/API/Workerと、ローカルNode実行の双方について、匿名の利用品質、例外、Web Vitals、HTTP、生成パイプラインを同じ相関モデルで長期監視する必要がある。特定のViewerへアプリを直接結合せず、監視障害が番組生成を止めない構成が必要である。

## 決定

OpenTelemetryをテレメトリ契約にし、Viewerと保存先にはLinux上のSigNoz Community、OpenTelemetry Collector、ClickHouseを採用する。アプリ本体はCloudflareへ配備し続け、監視基盤だけを分離してセルフホストする。

- Domain/ApplicationはOpenTelemetryへ依存しない。計測はappsと外部adapterで行う。
- NodeはOpenTelemetry Node SDK、Cloudflare WorkersはネイティブOTLP exportを使う。
- Browserは認証済みsame-origin gatewayへだけ送信し、Collectorを直接公開しない。
- 通常traceは20%、logsは100%。Cloudflare側の永続保存は無効にする。
- ログ30日、トレース15日、メトリクス180日、バックアップ7世代を運用目標にする。
- Collector停止時は有界batchからテレメトリを破棄し、アプリ処理を継続する。

## Privacy契約

属性はallowlist方式とする。ユーザーID、入力値、認証情報、RSS本文、台本、音声内容、完全URLを送らない。Browserイベントはログイン結果、生成要求、音声再生、購読変更、生成時刻変更に限定する。匿名品質データは既定ONだが、Do Not TrackまたはユーザーのOFFを優先し、変更時は再読み込みして送信前batchを破棄する。

## 判断要因

- OTLPを境界にすればSigNoz以外のViewerへ交換できる。
- traces、logs、metricsを一つのUIとClickHouseで相関できる。
- Cloudflare配備と監視基盤の障害・更新範囲を分離できる。
- Community版はセルフホストでき、ライセンス費用なしで開始できる。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| Cloudflare内蔵監視だけ | Browserから生成Workerまでの横断相関と長期保持を一つの契約で管理しにくい | 必要な保持・相関・alertが全て提供される |
| Sentry/PostHogへ直接送信 | アプリが個別vendor SDKへ結合し、セルフホスト構成が分散する | 個別製品固有機能がOTLP互換性より重要になる |
| Prometheus/Loki/Tempo/Grafanaを個別構築 | 初期運用componentと統合設定が増える | 個別componentの独立scaleが必要になる |

## 結果

アプリ配備は従来どおりCloudflareで継続できる。監視側にはLinux、TLS、SMTP、ClickHouse backupの運用責任が増える。Cloudflare destination作成、SigNoz UI上の保持期間・dashboard・alert適用、復元試験は実環境の資格情報が必要な受け入れ作業として残る。

## 検証証拠

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
- `pnpm contract:check && pnpm test:e2e`
- `docker compose -f infra/observability/compose.gateway.yaml config`
- Linux実環境でのend-to-end trace、SMTP発火/復旧、backup復元
