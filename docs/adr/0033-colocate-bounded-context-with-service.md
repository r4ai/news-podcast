# ADR-0033: Bounded Contextを対応サービスへコロケーションする

- Status: Accepted
- Date: 2026-08-12
- Decision owners: Product owner / Architecture
- Supersedes: N/A
- Superseded by: N/A
- Related: ADR-0001、`docs/architecture.md`

## コンテキストと変更契機

純粋なContextを`contexts/`、配備shellを`services/`へ分ける案は、同じdomain/applicationを複数runtimeで再利用する場合には有効である。今回選択した4 Bounded Contextはそれぞれ1つのstateful serviceと1対1であり、分離すると変更時の移動、所有権の把握、依存監査が複雑になる。

## 決定

各サービス配下へ`domain / application / adapters / runtime`をコロケーションする。Onionの依存方向はdirectory分離ではなくpackage export、lint、dependency graph testで強制する。

```text
services/<bounded-context>/
  src/
    domain/          # pure value / state transition
    application/     # use case / port
    adapters/        # SQLite / NATS / provider
    runtime/         # Layer / resource / entrypoint
    infrastructure/unsafe/ # 検査直後に閉じるinteropだけ
```

## 判断要因

- Contextの業務仕様、port、adapter、runtimeを一つの所有単位として辿れる。
- サービス削除・分割時の変更範囲が物理的に閉じる。
- domain/applicationを外部公開せず、誤った横断再利用を防げる。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| `contexts/`と`services/`を分離 | 現在は1対1であり探索コストだけが増える | 同一Contextを複数の独立runtimeが共有する |
| 全Contextを共通domain packageへ集約 | 境界間の型共有で結合し、分散モノリスになる | 単一Bounded Contextへ統合する判断がある |
| layer別top-level directory | 変更がサービスを横断し、所有権と配備影響が見えにくい | 単一配備へ戻す |

## 結果

### 利点

- 1ユースケースの変更を同じservice tree内で追跡できる。
- Context間通信がprotocol経由であることをimport graphから監査できる。

### 欠点とリスク

- 共通化候補が重複して見えるが、偶然の共通性をkernelへ早期昇格させない規律が必要になる。
- directoryだけでは依存方向を保証できないためCIのarchitecture testが必須になる。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | service treeと依存図 | Done | `docs/architecture.md` |
| ドメイン/ユースケース | service配下へ移設 | In progress | `services/*/src`の関数型縦断slice |
| OpenAPI/外部契約 | N/A — Gateway契約は独立 | Done | `packages/contracts` |
| コード/ポート | architecture testとpackage export制限 | Done | `scripts/check-architecture.mjs` |
| データ/ストレージ | serviceごとのmigration所有 | Pending | `services/*/migrations` |
| 実行/配備 | serviceごとのentrypoint | Pending | Compose |
| 認証/セキュリティ | Context間protocolへActorを付与 | Done | `packages/protocols/src/envelope.ts` |
| フロント/品質保証 | N/A — Gatewayだけを利用 | Done | Web dependency rule |
| テスト/運用 | import graph、context contract test | Done | architecture test、service unit tests |

## 再検討条件

- 同一domain/applicationを2つ以上の独立配備が共有することが確定する。
- service内の独立scale/所有境界が実測され、Context分割が必要になる。

## 受け入れゲートと未決事項

- None。

## 検証証拠

- architecture dependency testとworkspace typecheck。
