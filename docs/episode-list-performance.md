# Episode一覧の性能budget

一覧は`EpisodeSummary`（id / title / createdAt）、詳細は`EpisodeDetail`（summary + script / sources）を返す。[ADR-0100](adr/0100-separate-episode-summary-from-detail.md)に更新順と互換性を定義する。

| 状態 | 取得 | 表示・復旧 |
| --- | --- | --- |
| 初回一覧 / 次ページ | summaryのみ（20件） | 題名・日時、既存cursorで継続 |
| 一覧から再生 | 音声endpoint | detail JSON不要 |
| 詳細選択 / URL直リンク | 選択した1件のdetail | Suspense skeleton |
| detail失敗 → 再試行 | 同じdetailだけ再取得 | 一覧と再生は維持 |
| 次ページ失敗 → 再試行 | 同じcursorを再取得 | 取得済みページを維持 |

## 再現可能な計測

```sh
pnpm --filter @news-podcast/gateway exec vitest run src/runtime/episode-list.performance.test.ts --reporter=verbose --silent=false
```

最大長20件（title各500文字、script各20,000文字、source title各500文字の日本語）を投入する。実Gateway HTTP handlerを通したsummaryと、旧full-page形状をloopback HTTP serverから返す。serverで400 ms待ち、16,000 bytes / 100 msの分割転送（1.28 Mbit/s）を行い、fetchの最初のbody chunk到着、全body bytes、JSON.parseの実時間を測る。summaryは3回、旧形状は1回。CIの通常Gateway test/coverageに含む。

| 計測（2026-09-20、ローカルNode） | 旧full形状 | summary |
| --- | ---: | ---: |
| UTF-8 JSON bytes | 1,263,736 | 31,956（97.47%削減） |
| TTFB | 417.82 ms | 404.75–405.86 ms |
| body完了 | 8,235.20 ms | 505.25–506.44 ms |
| JSON.parse | 0.435 ms | 0.017–0.031 ms |

TTFBの改善は主張しない。効果は主にbody転送とparse量の削減。ネットワーク帯域/latencyを再現するテストであり、実機mobile CPU・TLS・稼働中の認証/NATS/DB負荷を測るものではない。SQLiteの実query投影・owner/keyset・RPCは別の結合テストで確認する。

| 回帰budget | CI判定 |
| --- | --- |
| 20件のpayload | 40,000 bytes以下、旧形状の4%未満 |
| TTFB（400 ms回線モデル） | 1,500 ms未満（CI scheduling余裕込み） |
| body完了 | 2,000 ms未満、旧形状の1/4未満 |
| JSON.parse | 20 ms未満（ローカルCPU、機種比較用途ではない） |

## 稼働中の観測

Gatewayの既存Effect OTLP layerで以下をexportする。個人情報・owner ID・cursor・題名はlabelに含まない。

| Metric | 計測範囲 | Grafana alert |
| --- | --- | --- |
| `episode.list.payload.bytes` | 成功listの非圧縮UTF-8 JSON | 40,000 bytes超の応答を過去5分に観測、1分継続 |
| `episode.list.duration.millis` | list handlerの認証/RPCを含む所要時間（成功/失敗） | 5分で20件以上ありp95 > 500 msが10分継続 |

Prometheus名は`episode_list_payload_bytes_{bucket,count,sum}`、`episode_list_duration_millis_{bucket,count,sum}`。alert定義は`infra/observability/grafana/provisioning/alerting/rules.yaml`。通信がない場合は正常扱い。

payload alertではRPC/list projectionやOpenAPIに本文が戻っていないか確認し、上記計測を実行する。duration alertではGateway認証→NATS list RPC→SQLiteのtraceを辿る。handler latencyはclient回線のTTFBとは別指標である。
