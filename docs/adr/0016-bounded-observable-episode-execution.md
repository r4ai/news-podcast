# ADR-0016: Episode生成を有界leaseと永続checkpointで実行する

- Status: Accepted
- Date: 2026-08-10
- Decision owners: Product owner / Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: ADR-0002、ADR-0003、ADR-0010、ADR-0013、ADR-0015、ADR-0017

## コンテキストと変更契機

Episode生成は60秒のDB leaseを取得する一方、lease更新を行わず、Node Workerの1秒timerは前回処理の完了を待たずに次の処理を開始していた。AgentまたはVOICEVOXが60秒を超えると同じjobが再取得され、試行数と外部処理が無制限に増え、古い実行は完成してもfenceにより確定できなかった。監視には完了時durationしかなく、停止中job、lease再取得、試行上限、監視欠損を検出できなかった。

現在の実動構成はNode、SQLite、S3互換ObjectStore、外部VOICEVOXである。Cloudflare consumerは未接続のため、今回の実装対象はNodeとし、leaseとcheckpointのportは将来のD1/Queues実装でも同じ不変条件を要求する。

## 決定

同一jobの自動試行を初回込み4回へ固定する。60秒leaseを15秒ごとに更新し、すべての状態変更と成果物確定を`status + lease token + lease expiry`でfenceする。入力、時間、応答byteを有界化し、台本とVOICEVOX chunkをdurable checkpointとして保存する。

| component | 実行場所 | trigger | durable state | terminal cleanup / recovery |
| --- | --- | --- | --- | --- |
| API | Node container | HTTP | SQLite job | cancel/retryをowner scopeで記録 |
| Scheduler/Reconciler | Node Worker | 逐次poll loop | SQLite lease/event/cleanup queue | deadline・上限jobをfailed化 |
| Agent | Node Worker | fenced job lease | verified draft checkpoint | 10分deadline、retry時はcheckpoint再利用 |
| VOICEVOX | 外部container | 未完chunk | S3 chunk + SQLite hash/index | 20分deadline、未完chunkだけ再生成 |
| Episode commit | Node Worker | 全chunk検証後 | SQLite Episode + final WAV | fence成功時だけ公開、一時objectはqueue cleanup |
| OTel/SigNoz | 別process/container | 常時計測 | ClickHouse / SigNoz metastore | alert、dashboard、retention |
| Watchdog | 同一host別container | 1分poll | 小さな通知state | SigNoz非依存SMTP通知 |

```mermaid
sequenceDiagram
  participant Loop as Worker loop
  participant DB as SQLite
  participant Agent as Podcast Agent
  participant TTS as VOICEVOX
  participant S3 as ObjectStore
  Loop->>DB: lease(attempt <= 4, token, 60s)
  par 15秒ごと
    Loop->>DB: renew(token)
  and pipeline
    Loop->>DB: load verified draft/chunks
    alt draftなし
      Loop->>Agent: run(signal, 10m)
      Loop->>DB: save draft(token)
    end
    loop 未完chunkのみ
      Loop->>TTS: synthesize(signal, bounded)
      Loop->>S3: put deterministic chunk
      Loop->>DB: record hash/progress(token)
    end
    Loop->>S3: put final WAV
    Loop->>DB: commit Episode(token)
  end
  Note over Loop,DB: renew/fence失敗時はabortし、古い実行はcommit不能
```

### 強制する上限

- 台本6,000文字、Agent 10分、VOICEVOX stage 20分、保存2分、job全体30分。
- `/speakers` 10秒、`audio_query` 15秒、各`synthesis` 120秒。
- chunk 16 MiB、完成音声128 MiB。
- retry backoffは5秒、30秒、120秒。5回目のleaseはDBが拒否する。

### 監視責任

Worker生成traceは100%、logs/metricsは100%送信し、job IDはlogs/tracesだけに含める。active/stuck、queue/stage age、attempt、lease、deadline、checkpoint、provider、cleanup、canaryを低cardinality metricとして記録する。SigNoz v0.135 Dashboard V2とruleをTerraform管理し、SMTPへ発火・再通知・復旧通知する。

SigNozとは別のwatchdogがAPI、Worker、VOICEVOX、SigNoz、telemetry freshnessを確認する。watchdogは同一host配置のため、host全停止または全network断は検出できない残余リスクとして受容する。

## 判断要因

- 長時間の正常処理と停止した処理をlease更新とstage progressで区別する。
- process crash後は回収できる一方、stale processの書き込みを拒否する。
- 再試行回数、時間、入力、byteをstorage境界でも上限化する。
- 監視設定をversion管理し、監視欠損自体を通知する。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| leaseを30分へ延長するだけ | crash回収が遅く、30分超過時に同じ問題が再発する | すべての処理が短い同期処理になる |
| Worker単一flightだけ | process停止と将来の複数replicaでfencingできない | durable queueが重複配送しない保証を持つ |
| retry時に最初から再生成 | provider費用、時間、重複処理が増える | checkpoint保管費が再生成費を上回る |
| SigNoz UIで手作業設定 | drift、未適用、復旧不能を検出できない | dashboard/rule APIが廃止される |
| 同一host watchdogを置かない | SigNoz停止時に通知経路がなくなる | 外部dead-man serviceを必須化する |

## 結果

### 利点

- 同一jobの試行数は4を超えず、stale workerは成果物を公開できない。
- 長い音声生成はheartbeatで継続し、障害時は完了済みchunkから再開できる。
- 生成停止、監視停止、provider劣化を運用者が行動可能な形で検知できる。

### 欠点とリスク

- heartbeat、checkpoint、cleanup、監視IaCの実装と運用が増える。
- chunkと最終WAVの一時的な二重容量が必要になる。
- 同一host全停止は検知できず、完全なdead-man監視には外部serviceが必要である。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | bounded execution、監視、復旧 | Done | `docs/design.md`、`docs/architecture.md` |
| ドメイン/ユースケース | lease/checkpoint/cancel signal port | Done | application ports |
| OpenAPI/外部契約 | max attempt、progress、deadline | Done | generated OpenAPI |
| コード/ポート | heartbeat、fencing、deadline、resume | Done | Worker/adapters |
| データ/ストレージ | job constraint、checkpoint、event、cleanup | Done | migration 0008 |
| 実行/配備 | single-flight loop、watchdog | Done | Compose/apps |
| 認証/セキュリティ | telemetry allowlist、SigNoz service account | Done | observability/Terraform |
| フロント/品質保証 | 2/4、chunk進捗、cancel/retry | Done | Web/unit tests |
| テスト/運用 | clock、crash、fence、alert smoke | Partial | automated tests/runbook。live SMTP/VOICEVOXは配備secretが必要 |

## 再検討条件

- queue ageまたはCPU使用率のSLO違反が続き、複数WorkerまたはVOICEVOX horizontal scaleが必要になる。
- checkpoint保管量がEpisode音声量の2倍を継続的に超える。
- host全停止の検出要件が発生し、外部dead-man serviceを採用する。

## 受け入れゲートと未決事項

- SMTP資格情報、通知先、SigNoz service account keyは配備先secretとして必要。
- Cloudflare consumer実装は今回の対象外。

## 検証証拠

- 60秒超TTS、複数worker、heartbeat停止、4回上限、cancel、chunk再開のintegration test。
- OpenAPI、workspace品質gate、Compose health、Terraform validate/plan。
- live OpenAI + VOICEVOX smoke、SigNoz query、SMTP発火・復旧試験。
