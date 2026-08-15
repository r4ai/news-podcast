# ADR-0043: 永続化をDrizzle ORMへ統一しマイグレーションを導入する

- Status: Accepted
- Date: 2026-08-15
- Decision owners: Platform
- Supersedes: N/A
- Superseded by: N/A
- Related: ADR-0033（境界づけられたコンテキストとサービスの同居）、ADR-0034（関数型ドメインとEffect境界）、ADR-0036（永続的なサービス整合性）、ADR-0039（Node自己ホスト専用）、ADR-0044

## コンテキストと変更契機

**確認済みの事実**

- ORMもクエリビルダも無く、`services/*/src` 全体に生SQL文字列が散在していた
- **マイグレーション機構が存在しなかった**。各アダプタが構築時に `CREATE TABLE IF NOT EXISTS` を実行し、スキーマ変更は `PRAGMA table_info` + `ALTER TABLE`（`sqlite-subscription-repository.ts`）や起動時 backfill UPDATE（`episode-production/.../sqlite.ts`）で凌いでいた
- 接続確立処理が5箇所に複製され、`:memory:` でのWAL有無など規則が食い違っていた
- `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` の手書きトランザクションが4箇所に再実装されていた
- episode-production は**1プロセスで同じDBファイルへ最大6本**の `DatabaseSync` を開いており、`production_agent_runs.job_id → episode_jobs(job_id)` の外部キーが接続をまたいで宣言されていた
- テストが本番DDLを手で複製しており、両者が乖離しても検知できなかった

**制約**

- ADR-0039 により実行基盤は Node 自己ホストのみ。`infra/Dockerfile.node` は `pnpm install --network=none` で構築する
- `pnpm-workspace.yaml` は `strictDepBuilds: true` で、依存のビルドスクリプトを既定で拒否する
- ADR-0034 により `services/*/src` では `class` 宣言が禁止（`scripts/check-architecture.mjs`）

## 決定

**drizzle-orm `1.0.0-rc.4` の `drizzle-orm/node-sqlite` ドライバ**へ統一し、
**drizzle-kit によるマイグレーション**をスキーマの唯一の所有者とする。

- DBエンジンはSQLiteのまま、境界づけられたコンテキストごとに4ファイルを維持する（ADR-0033）
- サービスごとに独立した `drizzle/schema.ts` を持ち、サービス間で共有しない
- 接続は**サービスプロセスにつき1本**。`@news-podcast/persistence` が確立規則を一元化する
- 起動時DDLは全廃し、`bootstrap.ts` がマイグレーションを適用する
- テストは本番と同一のマイグレーションでDBを構築する
- drizzle-kit が生成できない `STRICT` はマイグレーションSQLへ手で追記し、
  `sqlite_master` を検査する回帰テストで固定する

## 判断要因

- ネイティブ依存を増やさないこと（`--network=none` と `strictDepBuilds` を維持できるか）
- 既存の同期トランザクション・リース機構を作り替えずに済むこと
- STRICT / CHECK / 部分インデックス / 複合外部キーを失わないこと

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| Prisma 7 | SQLiteでは `@prisma/adapter-better-sqlite3`（ネイティブ）が必須。`prebuild-install` が導入時にGitHubから取得するため `--network=none` のDockerビルドが失敗し、`strictDepBuilds` の例外追加も要る。加えて非同期APIのためリース・単一ライタ機構の全面改修が必要で、STRICT/CHECK/トリガ/部分インデックスを表現できない | Prismaが純JSのSQLiteドライバを提供し、かつ同期実行に対応した場合 |
| @effect/sql-sqlite-node | Effect統合は最も自然でSqliteMigratorも付属するが、ORMではなくSQLは手書きのまま残る。「生SQLの散在をやめる」という主目的を達成しない | SQLの型付き組み立てが十分に成熟した場合 |
| PostgreSQLへの移行 | ADR-0039（Node自己ホスト専用）と `compose.yaml`／バックアップ運用（`scripts/sqlite-state.mjs`）の書き換えを伴い、今回の目的に対して変更量が過大 | 単一ノードの書き込み並行性が上限に達した場合 |
| drizzle安定版 `0.45.2` | `drizzle-orm/node-sqlite` は1.0系列にのみ存在する。安定版では better-sqlite3（ネイティブ）か sqlite-proxy（非同期・トランザクション自前実装）しか選べない | node-sqlite ドライバが安定版へ入った場合 |

## 結果

### 利点

- スキーマ変更が追跡可能になり、起動時DDLと場当たり的な `ALTER TABLE` が消えた
- テスト用スキーマが本番から乖離する余地が構造的に無くなった
- 接続確立・PRAGMA規則・DB span属性が1箇所に集約された
- 接続跨ぎの外部キー宣言という不整合が解消した
- ネイティブ依存ゼロのため Dockerfile とサプライチェーン方針は無変更

### 欠点とリスク

- **1.0 RC への依存**。APIが変わりうる。`saveExact` で固定し、ドライバ接触面を
  `infrastructure/unsafe/drizzle/open.ts` に閉じて追従範囲を最小化している
- `STRICT` は手追記のため、マイグレーション再生成時に失われうる（回帰テストで検知）
- `better-auth` が `drizzle-orm ^0.45.2` を optional peer に持つため `pnpm install` で
  peer警告が出る。drizzleアダプタは未使用（kysely経由）で実害はない

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | 永続化層とディレクトリ構成の記述を更新 | Done | `docs/architecture.md` |
| ドメイン/ユースケース | 変更なし（境界での再検証は維持） | Done | `services/*/src/domain` |
| OpenAPI/外部契約 | 変更なし | Done | `pnpm contract:check` |
| コード/ポート | 全サービスの永続化アダプタを移植 | Done | `services/*/src/adapters/persistence` |
| データ/ストレージ | 初期マイグレーションを各サービスに追加。既存volumeは作り直し | Done | `services/*/drizzle/migrations` |
| 実行/配備 | Dockerfile は無変更。`packages/persistence` を COPY 対象へ追加 | Done | `infra/Dockerfile.node` |
| 認証/セキュリティ | Better Auth は自身のテーブルを所有し続ける | Done | `services/identity-access/drizzle/schema.ts` |
| フロント/品質保証 | 変更なし | Done | N/A |
| テスト/運用 | schema.test.ts で STRICT/CHECK/索引を固定 | Done | `pnpm test` |

## 再検討条件

- drizzle 1.0 が安定版に到達したら固定バージョンを更新する
- 単一ノードの書き込み並行性が上限に達したらエンジン選択を再検討する

## 受け入れゲートと未決事項

- None

## 検証証拠

- `pnpm lint && pnpm typecheck && pnpm test`
- `pnpm contract:check`（OpenAPI契約の非退行）
- 各サービスの `src/adapters/persistence/schema.test.ts`
