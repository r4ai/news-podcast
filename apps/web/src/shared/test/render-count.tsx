import type { FunctionComponent, ReactNode } from "react"

/**
 * 「どのcomponentが何回描かれたか」を数える。
 *
 * 予算をテストに書ける形にするのが目的。React Compilerが入っていても、
 * stateを置く場所を間違えれば無関係な部分木まで描き直される。それは目視では
 * 気づけず、Web Vitalsにも埋もれる。ここで数字にして固定する。
 *
 * 本物のcomponentを`vi.mock`で包んで使う。production側へ計測用のコードを
 * 持ち込まずに、実物の木のまま数えられる。件数はmodule単位の共有なので、
 * ファイルごとに隔離されるvitestの実行単位とちょうど一致する。
 *
 * ```ts
 * vi.mock("./article-row", async (importOriginal) => {
 *   const actual = await importOriginal<typeof import("./article-row")>()
 *   const { watchRenders } = await import("@/shared/test/render-count")
 *   return { ...actual, ArticleRow: watchRenders("ArticleRow", actual.ArticleRow) }
 * })
 * ```
 */
const counts = new Map<string, number>()

/** 本物のcomponentを、描画回数を数える同等品で包む。 */
export function watchRenders<P extends object>(
  name: string,
  component: FunctionComponent<P>
): FunctionComponent<P> {
  // 包んだ関数がcomponent本体になる。hookは全てこの中で呼ばれるので呼び出し
  // 順は変わらない。module評価時に1度だけ作るのでJSXのtypeは安定し、親の
  // メモ化によるbailoutもそのまま効く。
  function watched(props: P): ReactNode {
    counts.set(name, (counts.get(name) ?? 0) + 1)
    // 対象はいずれも同期componentなので、awaitされる戻り値は現れない。
    return component(props) as ReactNode
  }
  Object.defineProperty(watched, "name", { value: name })
  return watched
}

export function renderCount(name: string): number {
  return counts.get(name) ?? 0
}

export function renderCounts(): Readonly<Record<string, number>> {
  return Object.fromEntries(counts)
}

export function resetRenderCounts(): void {
  counts.clear()
}

/**
 * 描画が止まるまで待つ。
 *
 * 初回表示では、facetsや同期ジョブなど後から届くqueryが順に描画を起こす。
 * それは操作が起こした描画ではないので、操作前の基準はここまで待ってから
 * 取る。そうしないと「打鍵で何回描き直されたか」に初期化の分が混ざる。
 */
export async function waitForRenderQuiescence(
  waitFor: (
    callback: () => void,
    options?: { timeout?: number; interval?: number }
  ) => Promise<unknown>,
  name: string
): Promise<void> {
  let previous = -1
  await waitFor(
    () => {
      const current = counts.get(name) ?? 0
      const stable = current === previous && current > 0
      previous = current
      if (!stable) throw new Error(`${name} はまだ描画中 (${current})`)
    },
    { timeout: 5_000, interval: 60 }
  )
}
