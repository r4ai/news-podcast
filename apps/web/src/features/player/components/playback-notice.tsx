import { useAtomValue, useSetAtom } from "jotai"
import { AlertTriangle } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import {
  hasPlaybackErrorAtom,
  isBufferingAtom,
  retryPlaybackAtom,
} from "../atoms"

/**
 * 「音が出ていない理由」を言う2つ。待ちと失敗では置き場所を変える。
 *
 * 押したのに何も聞こえないとき、利用者は押せていないのか回線が遅いのかを
 * 見分けられない。番組の音声はGateway経由でS3からstreamされるので、鳴り始める
 * までに間が空くのは普通のことで、失敗と区別して伝える必要がある。
 *
 * 購読するのは待ち状態と失敗だけ。位置や再生状態は見ないので、鳴っている間
 * ここが描き直されることはない (docs/design.md §7.2)。
 */

/**
 * 読み込み待ち。**題名の下の1行に収まる長さ**に留め、バーの高さを変えない。
 *
 * 待ちは鳴らすたびに起きる。行を1本増やす作りにすると、押すたびにバーが
 * 伸び縮みして本文が揺れる。回っていることは再生ボタンの外周が示すので、
 * ここは字だけを担う。
 */
export function PlaybackBusyLabel() {
  const buffering = useAtomValue(isBufferingAtom)
  const failed = useAtomValue(hasPlaybackErrorAtom)
  if (!buffering || failed) return null

  return (
    <p
      aria-live="polite"
      className="shrink-0 truncate text-xs text-muted-foreground"
      role="status"
    >
      読み込み中…
    </p>
  )
}

/**
 * 失敗は`alert`で割り込み、バーの上端へ1行を足して伝える。
 *
 * 待ちと違って、待っていても解消しない。原因 (期限切れURL、回線、S3) は
 * 要素からは判らないので、言い分けずにやり直す道だけを同じ行へ置く。
 * 高さが変わることは許容する。失敗は稀で、そのとき最も読ませたいものだから。
 */
export function PlaybackErrorBanner() {
  const failed = useAtomValue(hasPlaybackErrorAtom)
  const retry = useSetAtom(retryPlaybackAtom)
  if (!failed) return null

  return (
    <p
      className="flex items-center gap-2 border-b border-[var(--glass-border)] bg-destructive/10 px-3 py-2 text-xs text-destructive"
      role="alert"
    >
      <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        音声を再生できませんでした
      </span>
      <Button
        className="h-7 shrink-0 rounded-full px-3 text-xs"
        onClick={() => retry()}
        size="sm"
        variant="outline"
      >
        再試行
      </Button>
    </p>
  )
}
