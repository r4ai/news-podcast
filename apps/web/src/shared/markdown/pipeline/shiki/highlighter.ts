import { createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import { bundledLanguages } from "shiki/langs"
import githubDark from "shiki/themes/github-dark-default.mjs"
import githubLight from "shiki/themes/github-light.mjs"

export const LIGHT_THEME = "github-light"
export const DARK_THEME = "github-dark-default"

let highlighterPromise: Promise<HighlighterCore> | undefined

/**
 * Shikiのfine-grained bundleを使う単一のhighlighterインスタンス。
 * 言語文法は同梱せず、初回利用時に必要な言語だけ動的importする
 * (`shiki`本体+全言語同梱は数MBになるため)。`bundledLanguages` の各値は
 * shikiパッケージ側で `() => import("@shikijs/langs/xxx")` と静的に
 * 書かれているため、bundlerが言語ごとに個別chunkへ分割できる。
 * Oniguruma wasmも避け、JS正規表現エンジンでバンドルを軽く保つ。
 */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighterPromise
}

const loadingLanguages = new Map<string, Promise<boolean>>()

/**
 * 指定した言語の文法を遅延importして読み込む。
 * 未知/存在しない言語ではエラーを投げず `false` を返し、呼び出し側は
 * プレーン表示にフォールバックできる。
 */
export async function ensureLanguageLoaded(lang: string): Promise<boolean> {
  const highlighter = await getHighlighter()
  if (highlighter.getLoadedLanguages().includes(lang)) {
    return true
  }
  const cached = loadingLanguages.get(lang)
  if (cached) {
    return cached
  }
  const loading = loadLanguage(highlighter, lang)
  loadingLanguages.set(lang, loading)
  return loading
}

async function loadLanguage(
  highlighter: HighlighterCore,
  lang: string
): Promise<boolean> {
  const load = (
    bundledLanguages as Record<
      string,
      (() => Promise<{ default: unknown }>) | undefined
    >
  )[lang]
  if (!load) {
    return false
  }
  try {
    const mod = await load()
    await highlighter.loadLanguage(mod.default as never)
    return true
  } catch {
    return false
  }
}
