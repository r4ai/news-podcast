/**
 * Shikiのdual-theme出力(`--shiki-light`/`--shiki-dark` のCSS変数)を、
 * アプリのダークモード切り替え(`.dark`)へ結び付けるための最小限のscoped
 * style。グローバルCSSファイルは変更せず、CodeBlockコンポーネント内で完結させる。
 * `--shiki-*` が存在しない(=Shikiでハイライトされなかった)場合はvarの
 * fallbackにより無害化される。
 */
export function ShikiThemeStyle() {
  return (
    <style>{`
.markdown-shiki, .markdown-shiki span { color: var(--shiki-light, inherit); }
.markdown-shiki { background-color: var(--shiki-light-bg, transparent); }
.dark .markdown-shiki, .dark .markdown-shiki span { color: var(--shiki-dark, inherit); }
.dark .markdown-shiki { background-color: var(--shiki-dark-bg, transparent); }
`}</style>
  )
}
