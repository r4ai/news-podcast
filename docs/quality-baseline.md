# 品質baseline

- 更新日: 2026-08-15
- 対象: Gateway、4 Context services、functional packages、Web

旧API/Workerと共有packageの削除後は、機能単位の複雑度と次の自動gateをbaselineにする。生成物や外部資格情報を要するlive smokeはcoverageへ含めない。

## 必須gate

| 義務 | 証拠 | 状態 |
| --- | --- | --- |
| domain/application unit | `pnpm test` | Fulfilled |
| service SQLite/NATS integration | service別adapter/runtime tests | Fulfilled |
| backend縦断 | `pnpm test:e2e:functional` | Fulfilled |
| OpenAPI lint・生成差分・型 | `pnpm lint`、`pnpm contract:check` | Fulfilled |
| Web model / component | `pnpm --filter web test` | Fulfilled |
| desktop/mobile VRT | `pnpm test:visual` | Fulfilled |
| browser E2E | `pnpm test:e2e` | Fulfilled |
| functional coverage | `pnpm test:coverage:functional` | Fulfilled |
| service state復旧 | `pnpm test:sqlite-state` | Fulfilled |
| 共通信頼性module | `pnpm test:coverage:reliability`（line/branch 90%以上） | Fulfilled |
| process/依存障害注入 | `pnpm reliability:chaos` | Fulfilled |
| Watchdog / Grafana MCP | `pnpm observability:validate`、`pnpm observability:smoke`、`pnpm mcp:check` | Fulfilled |

functional coverageの最低値はlines 75%、branches 60%とする。live OpenAI + VOICEVOX smokeはAPI keyと外部runtimeを要する受け入れ確認として分離し、fake provider、schema拒否、timeout、retry上限をCIで常時検証する。

## GitHub Actionsへの対応

| Check | 証拠 |
| --- | --- |
| `CI / static` | `format:check`、`lint`、`typecheck`、`build`、契約、Compose、Storybook |
| `CI / unit` | `test`、`test:coverage:functional`、`test:coverage:reliability` |
| `CI / web-e2e` | `test:e2e` |
| `CI / visual` | `test:visual` |
| `CI / functional-e2e` | `test:e2e:functional` |
| `CI / observability` | `observability:validate`、fake observed stack、`observability:smoke` |
| `CI / security` | pinact、actionlint、zizmor、Gitleaks、`pnpm audit --audit-level=high` |

通常CIは資格情報なしのfake providerだけを使う。PRのセキュリティ検査はbase workflowからPRツリーを静的解析し、PR由来のコードを実行しない。詳細は[CIとサプライチェーン防御](ci.md)を参照する。
