import { ChevronDown, Play } from "lucide-react"

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
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"

import { episodeSubtitle, type Episode } from "@/features/episodes"

export type EpisodeCardProps = {
  readonly episode: Episode
  readonly disabled: boolean
  readonly loading: boolean
  readonly onPlay: (episodeId: string) => void
}

export function EpisodeCard({
  disabled,
  episode,
  loading,
  onPlay,
}: EpisodeCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{episode.title}</h2>
        </CardTitle>
        <CardDescription>{episodeSubtitle(episode)}</CardDescription>
        <CardAction>
          <Button
            disabled={disabled}
            onClick={() => onPlay(episode.id)}
            size="sm"
          >
            {loading ? (
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
              <Button className="w-full justify-between" variant="ghost" />
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
  )
}
