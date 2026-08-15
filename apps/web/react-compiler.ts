import babel from "@rolldown/plugin-babel"
import { reactCompilerPreset } from "@vitejs/plugin-react"

/**
 * React Compilerを有効にするpluginを組み立てる。
 * vite・vitest・storybookが同じ設定でコンパイルするよう、1箇所だけで持つ。
 *
 * メモ化はCompilerに任せる方針 (ADR-0009)。`useMemo`/`useCallback`/`memo`は
 * 計測された退行が残る場合にだけ、根拠を書いて足す。
 */
export function reactCompiler() {
  return babel({ presets: [reactCompilerPreset({ target: "19" })] })
}
