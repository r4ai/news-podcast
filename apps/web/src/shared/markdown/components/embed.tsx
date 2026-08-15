import { allowlistedEmbedUrl, safeFallbackUrl } from "../lib/embed"

type EmbedProps = {
  readonly "data-embed-url"?: string
  readonly "data-embed-fallback"?: string
}

export function Embed({
  "data-embed-url": value = "",
  "data-embed-fallback": fallback = value,
}: EmbedProps) {
  const url = allowlistedEmbedUrl(value)
  if (!url) {
    const href = safeFallbackUrl(fallback)
    return href ? <a href={href}>{href}</a> : null
  }
  return (
    <iframe
      allow="fullscreen"
      className="my-4 aspect-video w-full rounded-md border border-border"
      loading="lazy"
      referrerPolicy="no-referrer"
      sandbox=""
      src={url.href}
      title={`Embedded content from ${url.hostname}`}
    />
  )
}

export function LinkCard({ "data-embed-url": value = "" }: EmbedProps) {
  const href = safeFallbackUrl(value)
  return href ? (
    <a
      className="my-4 block rounded-md border border-border px-4 py-3 font-medium hover:bg-muted/60"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {href}
    </a>
  ) : null
}
