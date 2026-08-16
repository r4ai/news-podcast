import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { Figure } from "./figure"

type ImageProps = ComponentPropsWithoutRef<"img"> & {
  readonly isBlock?: boolean
}

/**
 * `src` はrehype段階(baseUrl解決)で既に絶対URLになっている前提。
 *
 * `isBlock`(= 段落の唯一の中身)のときだけ図版として扱い、中央寄せと枠を
 * 付ける。文中のインライン画像(リンクカードのfaviconなど)に同じ装飾を掛けると
 * 本文が崩れるため、印は`rehype-mark-block-images`が付ける。
 *
 * キャプションは`![alt](src "title")`の`title`があるときだけ出す。`alt`は
 * 画像の代替テキストであってキャプションではない。実記事の`alt`は図の内容を
 * 説明した長文であることが多く、そのまま出すと本文の下に説明文が二重に並ぶ。
 *
 * 取得元は第三者サイトなので、参照元URLを渡さない。
 */
export function Image({
  alt,
  className,
  isBlock,
  title,
  ...props
}: ImageProps) {
  const img = (
    <img
      alt={alt ?? ""}
      className={cn(
        isBlock
          ? "mx-auto h-auto max-w-full rounded-md border border-border"
          : "inline-block h-auto max-w-full align-text-bottom",
        className
      )}
      decoding="async"
      loading="lazy"
      referrerPolicy="no-referrer"
      title={title}
      {...props}
    />
  )
  return isBlock && title ? <Figure caption={title}>{img}</Figure> : img
}
