import { ExternalLink } from "lucide-react"

type SourceFooterProps = {
  readonly "data-source-url"?: string
}

/**
 * 本文末尾の出典。変換器が付ける`Source: <url>`を
 * `rehype-source-footer`が印に変えたものを描画する。
 *
 * 裸のURLを本文の一段落として出すのではなく、区切り線付きのフッターにして
 * 「ここから先は本文ではない」ことを見た目で示す。長いURLは折り返す。
 */
export function SourceFooter({ "data-source-url": url }: SourceFooterProps) {
  if (!url) return null
  return (
    <footer className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
      <span className="mr-1.5">出典:</span>
      <a
        className="break-all font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        {url}
        <ExternalLink
          aria-hidden="true"
          className="ml-1 inline size-3.5 align-[-0.15em]"
        />
      </a>
    </footer>
  )
}
