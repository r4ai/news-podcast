import { safeFallbackUrl } from "./embed"
export type LinkCardMetadata = Readonly<{
  title?: string
  description?: string
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
    const candidate = text("image", 2048)
    const image = candidate ? safeFallbackUrl(candidate) : undefined
    return {
      title: text("title", 256),
      description: text("description", 512),
      image,
    }
  } catch {
    return {}
  }
}
