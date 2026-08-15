# Security Policy

## CIでの検査

GitHub Actionsのworkflowは、完全SHA固定、7日間のminimum release age、actionlint、zizmor、Gitleaks、`pnpm audit --audit-level=high`で検査する。PR用のセキュリティworkflowはPRコードをcheckout・実行しない。

## 秘密情報を見つけた場合

実在するcredentialを見つけた場合は、次の順序で対応する。

1. provider側で即時revokeまたはrotateする
2. 利用範囲、アクセスログ、影響期間を確認する
3. 必要に応じて関連credentialもrotateする
4. 修正PRには実値を貼らず、ログ・artifact・issueコメントにも出さない
5. 履歴からの除去が必要な場合は、rotate後に影響範囲を確認して別途実施する

テスト用のダミー値をallowlistへ追加する場合も、対象ファイルと値の性質を明記し、リポジトリ全体を無効化する設定は行わない。

## GitHub設定

GitHub Secret Scanning、Push Protection、CodeQL、Dependency Reviewの利用可否はリポジトリの公開状態・所有者・プランに依存する。現在のprivate個人所有リポジトリでは、Gitleaksをrequired CIとして使用する。

設定変更時は`docs/ci.md`のtrust boundaryと権限方針を更新する。
