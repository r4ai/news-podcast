import { useState, useTransition } from "react"
import { ChevronDown, Library, Play } from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"

import { api } from "@/api/client"
import { PageHeader } from "@/app/page-header"

export function LibraryPage() {
  const episodes = api.useSuspenseQuery("get", "/v1/episodes")
  const access = api.useMutation(
    "post",
    "/v1/episodes/{episodeId}/audio-access"
  )
  const [audioUrl, setAudioUrl] = useState<string>()
  const [pendingEpisodeId, setPendingEpisodeId] = useState<string>()
  const [pending, startTransition] = useTransition()

  function play(episodeId: string) {
    setPendingEpisodeId(episodeId)
    startTransition(async () => {
      try {
        const result = await access.mutateAsync({
          params: { path: { episodeId } },
        })
        setAudioUrl(result.url)
      } catch {
        toast.error("音声を再生できませんでした")
      } finally {
        setPendingEpisodeId(undefined)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="完成した音声と、台本の根拠になった記事を確認できます。"
        title="ライブラリ"
      />
      {audioUrl ? (
        <Card size="sm">
          <CardContent>
            <audio autoPlay className="h-11 w-full" controls src={audioUrl} />
          </CardContent>
        </Card>
      ) : null}
      {episodes.data.items.length > 0 ? (
        <div className="flex flex-col gap-4">
          {episodes.data.items.map((episode) => (
            <Card key={episode.id}>
              <CardHeader>
                <CardTitle>
                  <h2>{episode.title}</h2>
                </CardTitle>
                <CardDescription>
                  {new Date(episode.createdAt).toLocaleString("ja-JP")} ・ 出典
                  {episode.sources.length}件
                </CardDescription>
                <CardAction>
                  <Button
                    disabled={pending}
                    onClick={() => play(episode.id)}
                    size="sm"
                  >
                    {pendingEpisodeId === episode.id ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Play aria-hidden="true" data-icon="inline-start" />
                    )}
                    再生
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Collapsible>
                  <CollapsibleTrigger
                    render={
                      <Button
                        variant="ghost"
                        className="w-full justify-between"
                      />
                    }
                  >
                    出典を確認
                    <ChevronDown aria-hidden="true" data-icon="inline-end" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="mt-3 flex flex-col text-sm">
                      {episode.sources.map((source, index) => (
                        <li className="flex flex-col gap-3" key={source.url}>
                          {index > 0 ? <Separator /> : null}
                          <a
                            className="rounded-sm underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                            href={source.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {source.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Library aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>完成した番組はまだありません</EmptyTitle>
            <EmptyDescription>
              「今日」から最初のニュース番組を生成してください。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
