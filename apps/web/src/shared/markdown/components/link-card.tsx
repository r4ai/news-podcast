import { useState } from "react"
import { ArrowUpRight, Globe2, ImageIcon } from "lucide-react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { safeFallbackUrl } from "../lib/embed"

function Thumbnail({ src }: { readonly src: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex w-24 shrink-0 items-center justify-center self-stretch overflow-hidden border-l border-border bg-muted/50 sm:w-40">
      {failed ? (
        <ImageIcon
          aria-hidden="true"
          className="size-6 text-muted-foreground"
        />
      ) : (
        <img
          alt=""
          className="h-full min-h-32 w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
          src={src}
        />
      )}
    </div>
  )
}

export function LinkCard({
  "data-embed-url": value = "",
  "data-card-title": title,
  "data-card-description": description,
  "data-card-image": image,
}: {
  readonly "data-embed-url"?: string
  readonly "data-card-title"?: string
  readonly "data-card-description"?: string
  readonly "data-card-image"?: string
}) {
  const href = safeFallbackUrl(value)
  if (!href) return null
  const hostname = new URL(href).hostname
  const thumbnail = image ? safeFallbackUrl(image) : undefined
  return (
    <a
      className="group my-4 block rounded-xl outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      data-link-card=""
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <Card className="min-h-32 flex-row gap-0 py-0">
        <CardHeader className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-4">
          <CardTitle className="line-clamp-2 break-words">
            {title || hostname}
          </CardTitle>
          {description || !title ? (
            <CardDescription className="line-clamp-2 break-words">
              {description || href}
            </CardDescription>
          ) : null}
          <div className="mt-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Globe2 aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{hostname}</span>
            <ArrowUpRight
              aria-hidden="true"
              className="ml-auto size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </div>
        </CardHeader>
        {thumbnail ? <Thumbnail key={thumbnail} src={thumbnail} /> : null}
      </Card>
    </a>
  )
}
