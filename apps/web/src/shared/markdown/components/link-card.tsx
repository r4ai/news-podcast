import { useState } from "react"
import { ArrowUpRight, Globe2, ImageIcon } from "lucide-react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { safeFallbackUrl } from "../lib/embed"

const CARD_IMAGES = {
  thumbnail: {
    className: "h-32 w-auto max-w-full object-contain",
    fallbackClassName: "mx-8 size-6 text-muted-foreground",
    icon: ImageIcon,
  },
  favicon: {
    className: "size-3.5 shrink-0 object-contain",
    fallbackClassName: "size-3.5 shrink-0",
    icon: Globe2,
  },
} as const

/** Each URL is keyed by the caller so a new image starts with a fresh load state. */
function CardImage({
  src,
  variant,
}: {
  readonly src: string
  readonly variant: keyof typeof CARD_IMAGES
}) {
  const [failed, setFailed] = useState(false)
  const { className, fallbackClassName, icon: Icon } = CARD_IMAGES[variant]
  return failed ? (
    <Icon aria-hidden="true" className={fallbackClassName} />
  ) : (
    <img
      alt=""
      data-card-favicon={variant === "favicon" ? "" : undefined}
      className={className}
      src={src}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

export function LinkCard({
  "data-embed-url": value = "",
  "data-card-title": title,
  "data-card-description": description,
  "data-card-image": image,
  "data-card-favicon": favicon,
}: {
  readonly "data-embed-url"?: string
  readonly "data-card-title"?: string
  readonly "data-card-description"?: string
  readonly "data-card-image"?: string
  readonly "data-card-favicon"?: string
}) {
  const href = safeFallbackUrl(value)
  if (!href) return null
  const hostname = new URL(href).hostname
  const icon =
    safeFallbackUrl(favicon ?? "") || new URL("/favicon.ico", href).href
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
            <CardImage key={icon} src={icon} variant="favicon" />
            <span className="truncate">{hostname}</span>
            <ArrowUpRight
              aria-hidden="true"
              className="ml-auto size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </div>
        </CardHeader>
        {thumbnail ? (
          <div className="flex min-w-0 max-w-[45%] shrink-0 items-center justify-center self-stretch overflow-hidden border-l border-border bg-muted/50">
            <CardImage key={thumbnail} src={thumbnail} variant="thumbnail" />
          </div>
        ) : null}
      </Card>
    </a>
  )
}
