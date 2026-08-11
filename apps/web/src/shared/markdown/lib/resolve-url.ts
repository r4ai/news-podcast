/**
 * アーカイブ記事本文に含まれる相対URL(`assets/{hash}` 形式など)を
 * `baseUrl` 起点の絶対URLへ解決する。すでに絶対URL・アンカー・
 * `data:` URIのものはそのまま返す。
 */
export function resolveMarkdownUrl(
  src: string | undefined,
  baseUrl: string | undefined
): string | undefined {
  if (!src || !baseUrl) {
    return src
  }
  if (isAbsoluteOrSpecial(src)) {
    return src
  }
  try {
    return new URL(src, baseUrl).toString()
  } catch {
    return src
  }
}

function isAbsoluteOrSpecial(src: string): boolean {
  return /^([a-z][a-z\d+.-]*:|#|\/\/)/i.test(src)
}
