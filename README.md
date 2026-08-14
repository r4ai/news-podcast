# News Podcast

RSSから選んだニュースを、出典付きの短い音声番組としていつでも聴けるアプリです。

![News Podcast のデスクトップ画面](docs/assets/dashboard-desktop.png)

<p align="center">
  <img src="docs/assets/dashboard-mobile.png" alt="News Podcast のモバイル画面" width="360" />
</p>

## できること

- 購読中のRSSをもとに、ニュース番組の生成を依頼できます。
- 任意のRSSを登録し、新着記事を既読・保存状態付きで読めます。
- 元HTML、画像、CSSとMarkdownを自動保存し、元リンク失効後も参照できます。
- エージェントが保存記事を読み、必要に応じてWeb検索して番組を構成します。
- 生成中の状況を確認し、完成した番組を音声で再生できます。
- 各番組で元記事の出典を確認できます。
- 購読するフィードと日次の生成時刻を管理できます。

## 開発

環境構築、ローカルでの操作、コマンド、環境変数は[開発ガイド](docs/development.md)を参照してください。

システムの全体像は[アーキテクチャ](docs/architecture.md)、詳細設計と判断の記録は[設計書](docs/design.md)と[ADR](docs/adr/)にあります。

## Observability

```bash
pnpm dev:up:observed
pnpm observability:validate
pnpm observability:smoke
```

Grafanaは <http://localhost:3100>。Dashboardは[運用手順](infra/observability/README.md)にある8つを自動provisionし、`Alert → Service Drilldown → Tempo → Loki → Prometheus exemplar`の順で原因を追えます。

## 負荷テスト

ステージング相当のAPI・非同期生成負荷と、Fake OpenAI/VOICEVOXによるProvider Chaosは[負荷テスト運用手順](docs/operations/load-testing.md)を参照してください。
