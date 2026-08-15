const ALLOWED_EMBED_PATHS: Readonly<Record<string, RegExp>> = Object.freeze({
  "www.youtube.com": /^\/embed\/[A-Za-z0-9_-]+/,
  "www.youtube-nocookie.com": /^\/embed\/[A-Za-z0-9_-]+/,
  "player.vimeo.com": /^\/video\/\d+/,
  "speakerdeck.com": /^\/player\//,
  "www.docswell.com": /^\/slide\//,
  "codepen.io": /^\/[^/]+\/embed\//,
  "codesandbox.io": /^\/embed\//,
  "stackblitz.com": /^\/edit\//,
  "www.figma.com": /^\/embed/,
})

export const allowlistedEmbedUrl = (value: string): URL | undefined => {
  try {
    const url = new URL(value)
    const path = ALLOWED_EMBED_PATHS[url.hostname.toLowerCase()]
    return url.protocol === "https:" && path?.test(url.pathname)
      ? url
      : undefined
  } catch {
    return undefined
  }
}

export const safeFallbackUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
