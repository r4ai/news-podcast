export type LinkCardMetadata = Readonly<{
  title?: string
  description?: string
  favicon?: string
  image?: string
}>
const PREFIX = "link-card:v1:"

/** Archived metadata is untrusted. Only bounded text and HTTP(S) images pass. */
export const parseLinkCardMetadata = (
  value: string | null | undefined
): LinkCardMetadata => {
  if (!value?.startsWith(PREFIX) || value.length > 6_000) return {}
  try {
    const parsed: unknown = JSON.parse(value.slice(PREFIX.length))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {}
    const data = parsed as Record<string, unknown>
    const text = (key: string, limit: number) =>
      typeof data[key] === "string"
        ? data[key].trim().slice(0, limit) || undefined
        : undefined
    const asset = (key: string) => {
      const candidate = typeof data[key] === "string" ? data[key].trim() : ""
      if (!candidate || candidate.length > 2048) return undefined
      try {
        const url = new URL(candidate)
        return ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          url.href.length <= 2048
          ? url.href
          : undefined
      } catch {
        return undefined
      }
    }
    return {
      title: text("title", 256),
      description: text("description", 512),
      image: asset("image"),
      favicon: asset("favicon"),
    }
  } catch {
    return {}
  }
}
