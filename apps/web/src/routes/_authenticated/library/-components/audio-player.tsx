import { Card, CardContent } from "@workspace/ui/components/card"

import { recordBrowserEvent } from "@/shared/observability/events"

/**
 * 再生の成否はobservabilityの計測点なので、記録はここに閉じる。
 * 表示に必要なのは署名済みURLだけ。
 */
export function AudioPlayer({ src }: { readonly src: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <audio
          autoPlay
          className="h-11 w-full"
          controls
          onEnded={() => recordBrowserEvent("audio.completed")}
          onError={() => recordBrowserEvent("audio.error")}
          onPlay={() => recordBrowserEvent("audio.started")}
          src={src}
        />
      </CardContent>
    </Card>
  )
}
