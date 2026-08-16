/**
 * 見出しテキストからアンカー用のidを作る。
 *
 * `rehype-slug`(github-slugger)を使わないのは2つの理由から。
 * 1. GFM脚注が既に`user-content-fn-*`というidを作っており、名前空間を分けたい。
 * 2. 日本語の見出しはgithub-sluggerだと記号を落とすだけで実質そのまま残る。
 *    URLに載る文字列なので、ここでの正規化規則は自分で決められた方がよい。
 *
 * 変換規則は「小文字化 → 記号を`-`へ → 前後の`-`を落とす」。日本語や絵文字など
 * 非ASCIIはそのまま残す(encodeURIComponentで安全にURLへ載る)。全部落ちて空に
 * なる見出し(記号のみなど)は`section`にする。
 */
export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    // 制御文字とURLで意味を持つ記号、空白を区切りにする。
    .replace(/[\s!-,./:-@[-^`{-~]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
  return slug === "" ? "section" : slug
}

/**
 * 同じ見出しが2回出ても衝突しないよう、2つ目以降に連番を足す。
 * `seen`は呼び出し側が持ち回る(1つの文書の中だけで一意であればよい)。
 */
export function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base = slugify(text)
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  return count === 0 ? base : `${base}-${count}`
}
