import { Link } from "@tanstack/react-router"
import { Inbox } from "lucide-react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Spinner } from "@workspace/ui/components/spinner"

import type { PickerSourceState } from "../hooks/use-picker-sources"

const guidance = {
  checking: {
    title: "購読・同期状況を確認中…",
    description: "候補がない理由を確認しています。",
  },
  "source-error": {
    title: "購読・同期状況を確認できません",
    description: "通信状況を確認して、もう一度お試しください。",
  },
  "no-subscriptions": {
    title: "RSSフィードを追加しましょう",
    description: "記事を取り込むには、最初のRSSフィードを追加してください。",
    link: "RSSフィードを追加",
  },
  paused: {
    title: "購読が一時停止中です",
    description: "新しい記事を取り込むには、購読を再開してください。",
    link: "購読を再開",
  },
  syncing: {
    title: "記事を取り込み中です",
    description:
      "本文の取り込みが終わると選択できます。同期状況を確認するか、候補を再読み込みしてください。",
    link: "同期状況を確認",
  },
  "sync-failed": {
    title: "記事の取り込みに失敗しました",
    description: "購読画面で失敗理由を確認し、再同期してください。",
    link: "購読を管理・再同期",
  },
  empty: {
    title: "選べる記事がまだありません",
    description:
      "本文の取り込みが完了した記事だけを番組にできます。購読画面で同期状況を確認してください。",
    link: "購読を管理",
  },
  search: {
    title: "検索に一致する記事がありません",
    description: "検索語をクリアすると、ほかの候補を表示できます。",
  },
  "more-pages": {
    title: "このページには選べる記事がありません",
    description:
      "続きの記事を読み込んで、本文の取り込みが完了した候補を探せます。",
  },
} as const

export function ArticlePickerEmpty({
  state,
  onRetry,
  onClearSearch,
  onLoadMore,
  busy,
  onNavigate,
}: {
  readonly state: PickerSourceState | "search" | "more-pages"
  readonly onRetry: () => void
  readonly onClearSearch: () => void
  readonly onLoadMore: () => void
  readonly busy?: boolean
  readonly onNavigate: () => void
}) {
  const copy = guidance[state]
  return (
    <Empty>
      <EmptyHeader aria-live="polite" role="status">
        <EmptyMedia variant="icon">
          {state === "checking" ? (
            <Spinner aria-hidden="true" />
          ) : (
            <Inbox aria-hidden="true" />
          )}
        </EmptyMedia>
        <EmptyTitle>{copy.title}</EmptyTitle>
        <EmptyDescription>{copy.description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {"link" in copy ? (
          <Link
            className={buttonVariants({ size: "sm" })}
            onClick={onNavigate}
            to="/subscriptions"
          >
            {copy.link}
          </Link>
        ) : null}
        {state === "search" ? (
          <Button onClick={onClearSearch} size="sm">
            検索語をクリア
          </Button>
        ) : state === "more-pages" ? (
          <Button disabled={busy} onClick={onLoadMore} size="sm">
            {busy ? <Spinner data-icon="inline-start" /> : null}もっと読み込む
          </Button>
        ) : state !== "checking" ? (
          <Button disabled={busy} onClick={onRetry} size="sm" variant="outline">
            {state === "source-error" ? "再確認" : "候補を再読み込み"}
          </Button>
        ) : null}
      </EmptyContent>
    </Empty>
  )
}
