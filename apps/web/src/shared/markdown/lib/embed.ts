/**
 * 埋め込みへ与えてよいsandbox権限。
 *
 * `allow-same-origin`は**意図的に含めない**。`allow-scripts`と併せて与えると、
 * iframeの中のスクリプトが自分のsandbox属性を書き換えて制限を全て外せてしまう。
 * union型から外しておけば、その組み合わせは書こうとしても型で通らない。
 */
type SandboxToken = "allow-scripts" | "allow-popups"

type EmbedProvider = Readonly<{
  /** 許可するpath。hostnameが一致してもここを通らなければ埋め込まない。 */
  readonly path: RegExp
  /**
   * このproviderの再生・表示に必要な権限だけを列挙する。
   * 空配列（全禁止）が既定で、必要な物を1つずつ足す。
   */
  readonly sandbox: readonly SandboxToken[]
}>

/**
 * 自動ロードを許すproviderの一覧。ここに無いhostnameは、URLがどれだけ
 * 安全に見えてもiframeにせずリンクへ落とす。
 *
 * 挙げてあるのはいずれも動画プレイヤー・スライド・コードエディタで、
 * JavaScriptなしでは何も表示できない。`allow-scripts`だけを与えると
 * iframeは一意なオリジンで動き、親のDOM・Cookie・storageへは触れない。
 */
const ALLOWED_EMBEDS: Readonly<Record<string, EmbedProvider>> = Object.freeze({
  "www.youtube.com": {
    path: /^\/embed\/[A-Za-z0-9_-]+/,
    sandbox: ["allow-scripts"],
  },
  "www.youtube-nocookie.com": {
    path: /^\/embed\/[A-Za-z0-9_-]+/,
    sandbox: ["allow-scripts"],
  },
  "player.vimeo.com": { path: /^\/video\/\d+/, sandbox: ["allow-scripts"] },
  "speakerdeck.com": { path: /^\/player\//, sandbox: ["allow-scripts"] },
  "www.docswell.com": { path: /^\/slide\//, sandbox: ["allow-scripts"] },
  "codepen.io": { path: /^\/[^/]+\/embed\//, sandbox: ["allow-scripts"] },
  "codesandbox.io": { path: /^\/embed\//, sandbox: ["allow-scripts"] },
  "stackblitz.com": { path: /^\/edit\//, sandbox: ["allow-scripts"] },
  "www.figma.com": { path: /^\/embed/, sandbox: ["allow-scripts"] },
})

export type EmbedPolicy = Readonly<{
  readonly url: URL
  /** `<iframe sandbox>`へそのまま渡せる文字列。空文字は全権限を落とす。 */
  readonly sandbox: string
}>

/**
 * 許可リストに載っていればURLと与える権限を返す。載っていなければ`undefined`。
 */
export const allowlistedEmbed = (value: string): EmbedPolicy | undefined => {
  try {
    const url = new URL(value)
    const provider = ALLOWED_EMBEDS[url.hostname.toLowerCase()]
    if (url.protocol !== "https:" || !provider?.path.test(url.pathname)) {
      return undefined
    }
    return { url, sandbox: provider.sandbox.join(" ") }
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
