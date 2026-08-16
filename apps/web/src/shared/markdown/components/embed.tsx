import { allowlistedEmbed, safeFallbackUrl } from "../lib/embed"

type EmbedProps = {
  readonly "data-embed-url"?: string
  readonly "data-embed-fallback"?: string
}

/**
 * 許可リストに載ったproviderだけをiframeで自動ロードし、それ以外はリンクへ落とす。
 *
 * sandboxはprovider単位で必要な権限だけを与える(`lib/embed.ts`)。動画プレイヤーや
 * スライドはJavaScriptなしでは何も描けないため、全面禁止のままだとprovider側の
 * エラー画面が出るだけになる。`allow-same-origin`は決して与えないので、iframeは
 * 一意なオリジンで動き、親のDOM・Cookie・storageへは到達できない。
 *
 * 参照元は渡さない。どの記事を読んでいるかをprovider側へ知らせない。
 */
export function Embed({
  "data-embed-url": value = "",
  "data-embed-fallback": fallback = value,
}: EmbedProps) {
  const embed = allowlistedEmbed(value)
  if (!embed) {
    const href = safeFallbackUrl(fallback)
    return href ? <a href={href}>{href}</a> : null
  }
  return (
    <iframe
      allow="fullscreen"
      className="my-4 aspect-video w-full rounded-md border border-border"
      loading="lazy"
      referrerPolicy="no-referrer"
      sandbox={embed.sandbox}
      src={embed.url.href}
      title={`Embedded content from ${embed.url.hostname}`}
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
