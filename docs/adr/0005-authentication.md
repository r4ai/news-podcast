# ADR-0005: Better AuthのセッションとGoogle OIDCを初期認証にする

- Status: Accepted
- Date: 2026-08-09
- Decision owners: Product owner / Security
- Supersedes: N/A
- Superseded by: N/A
- Related: `apps/api`, OpenAPI security schemes

## コンテキストと変更契機

所有者別の購読、ジョブ、エピソードを保護する必要がある。初期ログインはGoogleだが、将来別OIDC providerを追加したい。

## 決定

Better Authがアプリセッションを発行し、`/v1` はsession cookieを認証する。Google OIDCはログイン上流として初期構成する。Google tokenを `/v1` のbearer認証として受理しない。ownerはsessionから導出し、body/pathにuserIdを置かない。

## 判断要因

- session管理とsocial loginの実績ある実装。
- provider追加をIdentityAccess adapter内へ局所化。
- owner列挙攻撃の抑制。

## 却下案

| 案 | 却下理由 | 再検討条件 |
| --- | --- | --- |
| Google bearerを直接 `/v1` で受理 | session revoke/複数providerを複雑化 | machine client向けOIDC bearer要件が確定する |
| 独自session実装 | security負担が大きい | Better Authが必要runtimeを満たさなくなる |
| URL/bodyでuserId指定 | IDORを誘発する | 管理者委任ユースケースが確定する |

## 結果

### 利点

- 認証とアプリ認可を分離できる。

### 欠点とリスク

- SQLite/D1 adapter差、cookie名/属性、CSRF/CORS同期が必要。

## 影響と同期

| 対象 | 必要な変更 | 状態 | 証拠 |
| --- | --- | --- | --- |
| 設計書 | session/OIDC分離 | Done | `docs/design.md` |
| ドメイン/ユースケース | owner identity | Done | application types |
| OpenAPI/外部契約 | SessionCookie/401/403/404 | Done | OpenAPI JSON（ADR-0008） |
| コード/ポート | Better Auth handler seam | Done | API app/adapters |
| データ/ストレージ | auth schema | Pending | Better Auth migration生成時 |
| 実行/配備 | local env/cloud secrets | Partial | env example/wrangler |
| 認証/セキュリティ | Google initial provider | Done | auth factory |
| フロント/品質保証 | login UI/stories | Done | `apps/web/src/routes/login.tsx` |
| テスト/運用 | auth matrix | Done | API unit / Web E2E |

## 再検討条件

- machine client、組織SSO、複数issuer bearer認証が必要になる。

## 受け入れゲートと未決事項

- catalog閲覧をpublicにするか、追加OIDC providerの優先順位。

## 検証証拠

- Better Auth factory/API typecheck。実Google通信は資格情報設定後。
