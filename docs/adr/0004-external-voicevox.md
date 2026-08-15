# ADR-0004: VOICEVOX Engineを外部サービスとして配置する

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: `services/episode-production/src/adapters/voicevox-speech-synthesizer.ts`（合成点）と`services/episode-production/src/adapters/voicevox/`（HTTP境界・API・WAV結合）

## コンテキストと変更契機

VOICEVOXは大きなnative runtimeでありWorkers内では実行できない。将来TTS providerを差し替え、ずんだもんを既定にしつつ変動するstyle IDへ対応する必要がある。

## 決定

VOICEVOXをHTTP port越しの外部コンテナとして扱う。Composeでは別service、Cloudflareでは外部endpointとする。既定はキャラクター名「ずんだもん」で、数値style IDは `/speakers` から解決する。

## 判断要因

- Web/API/Workerからnative依存を排除。
- provider差し替え可能性。
- style IDのversion差を吸収。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| API processへ組み込む | resource分離とWorkers対応ができない | 単一runtime用の軽量公式SDKが提供される |
| ずんだもんのIDを固定 | Engine versionで変わり得る | 公式が永続IDを保証する |
| OpenAI TTSへ統一 | ユーザーのVOICEVOX要件を満たさない | 要件変更 |

## 結果

### 利点

- TTSを独立スケール/更新できる。

### 欠点とリスク

- CloudflareからのTLS/auth、長文分割、health管理が必要。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | 外部seam | Done | `docs/design.md` |
| ドメイン/ユースケース | SpeechSynthesizer port | Done | application ports |
| OpenAPI/外部契約 | N/A — 内部provider | Done | N/A |
| コード/ポート | HTTP adapter/name resolution | Done | adapters source |
| データ/ストレージ | N/A — audio bytesのみ | Done | N/A |
| 実行/配備 | Compose別service | Done | compose file |
| 認証/セキュリティ | cloud endpoint auth | Pending | 運用判断待ち |
| フロント/品質保証 | style選択UI | Pending | 確認ゲート |
| テスト/運用 | mocked adapter test | Pending | 機能縦スライス |

## 再検討条件

- provider変更、永続style ID保証、またはTTS latency/SLO未達。

## 受け入れゲートと未決事項

- ずんだもん内のstyle、Cloudflare側endpoint認証、長文分割規則。

## 検証証拠

- adapter typecheck、Compose config。
