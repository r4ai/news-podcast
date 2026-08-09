# 実装規模・複雑度の記録

対象は `apps/**/src` と `packages/**/src` のTypeScript（生成物・coverageを除外）。分岐点は `if/for/while/case/catch/&&/||` の機械的な近似値で、循環的複雑度そのものではない。

| 指標 | 実装前（HEAD） | 実装後 | 1関数あたり |
| --- | ---: | ---: | ---: |
| 本体の非空行 | 1,398 | 4,275 | 19.7 → 17.9 |
| testの非空行 | 364 | 465 | — |
| 関数・class近似数 | 71 | 239 | — |
| 分岐点近似数 | 50 | 167 | 0.70 → 0.70 |

機能を縦に追加したため総量は増えたが、関数単位の本体行数と分岐密度は増加させていない。公開契約はHono schema、通信型は生成OpenAPI、外部処理はportに集約した。

## テスト義務

| 義務 | 証拠 | 状態 |
| --- | --- | --- |
| domain/application unit | `pnpm test` | Fulfilled |
| temp SQLite + pipeline integration | `apps/worker/src/local-flow.test.ts` | Fulfilled |
| OpenAPI lint・生成差分・型 | `pnpm lint`, `pnpm contract:check` | Fulfilled |
| Web純粋model | `apps/web/src/features/generation/model.test.ts` | Fulfilled |
| Storybook interaction・a11y addon | `foundation.stories.tsx`, addon-a11y | Fulfilled |
| desktop/mobile VRT | `pnpm test:visual` | Fulfilled |
| fake-provider browser E2E | `pnpm test:e2e` | Fulfilled |
| live OpenAI + VOICEVOX smoke | Docker daemon + API keyが必要 | External pending |

自動化可能な7/7を充足。live smokeは品質義務ではなく外部資格情報を要する受け入れ確認として分離する。
