import { useAtomValue, useSetAtom } from "jotai"
import { AlertTriangle, LoaderCircle } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import {
  hasPlaybackErrorAtom,
  isBufferingAtom,
  retryPlaybackAtom,
} from "../atoms"

/**
 * 「音が出ていない理由」だけを言う一行。
 *
 * 押したのに何も聞こえないとき、利用者は押せていないのか回線が遅いのかを
 * 見分けられない。番組の音声はGateway経由でS3からstreamされるので、鳴り始める
 * までに間が空くのは普通のことで、失敗と区別して伝える必要がある。
 *
 * 購読するのは待ち状態と失敗だけ。位置や再生状態は見ないので、鳴っている間
 * ここが描き直されることはない (docs/design.md §7.2)。
 */
export function PlaybackNotice() {
  const buffering = useAtomValue(isBufferingAtom)
  const failed = useAtomValue(hasPlaybackErrorAtom)

  if (failed) return <PlaybackError />
  if (!buffering) return null

  return (
    <p
      aria-live="polite"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
    >
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      読み込み中…
    </p>
  )
}

/**
 * 失敗は`alert`で割り込む。読み込み待ちと違って、待っていても解消しない。
 *
 * 原因 (期限切れURL、回線、S3) は要素からは判らないので、言い分けずに
 * やり直す道だけを同じ行へ置く。
 */
function PlaybackError() {
  const retry = useSetAtom(retryPlaybackAtom)

  return (
    <p
      className="flex items-center gap-1.5 text-xs text-destructive"
      role="alert"
    >
      <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
      音声を再生できませんでした
      <Button
        className="h-6 px-2 text-xs"
        onClick={() => retry()}
        size="sm"
        variant="outline"
      >
        再試行
      </Button>
    </p>
  )
}
