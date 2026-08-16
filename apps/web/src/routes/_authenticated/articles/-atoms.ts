import { atom } from "jotai"

import { isFeedSyncActive } from "@/features/subscriptions"
import { api } from "@/shared/api"
import { atomWithQuery, keyedAtomFamily } from "@/shared/state/query"
import { articleFacetsQueryOptions } from "./-queries"
import type { ArticlesSearch } from "./-model"

/**
 * 検索欄の打鍵途中の文字列。
 *
 * 絞り込みの正本はURLで、ここに置くのは「URLへ反映されるまでの一時的な値」
 * だけ。componentのstateにすると、その所有者から下がすべて描き直され、打鍵の
 * たびに一覧の全行が巻き添えになる。atomにすれば、購読しているのは入力欄
 * だけなので描き直しもそこで止まる。
 *
 * `base`は「この下書きがどのURL状態から始まったか」。戻る/進むやフィルタの
 * リセットでURLが外から変われば`base`と一致しなくなり、下書きは自動的に
 * 捨てられてURLの値に従う。前の値を覚えるEffectは要らない。
 */
export type SearchDraft = {
  readonly base: string
  readonly value: string
}

export const articleSearchDraftAtom = atom<SearchDraft | null>(null)

/** 入力欄に表示すべき文字列。純関数なので単体テストできる。 */
export function displayedSearchQuery(
  draft: SearchDraft | null,
  urlQuery: string
): string {
  return draft !== null && draft.base === urlQuery ? draft.value : urlQuery
}

/** AIエンリッチのキュー状況ダイアログの開閉。 */
export const enrichQueueOpenAtom = atom(false)

/**
 * ここから下はserver state。取得はTanStack Queryのままで、結果をatomとして
 * 配ることで購読の単位を細かくする。
 */

/** 絞り込み条件の同一性。物体の参照ではなく、送るqueryの中身で決める。 */
const searchKey = (search: ArticlesSearch) =>
  JSON.stringify([
    search.state,
    search.sort,
    search.q,
    [...search.feedIds].sort(),
    search.includeHidden,
  ])

/** RSS同期ジョブ。進行中の間だけ短い間隔で追う。 */
export const feedSyncJobsAtom = atomWithQuery(() =>
  api.queryOptions("get", "/v1/me/feed-sync-jobs", undefined, {
    refetchInterval: (query) =>
      query.state.data?.items.some(isFeedSyncActive) ? 1_000 : false,
  })
)

/** 同期が動いているか。真偽値だけを購読すれば、ジョブの中身の変化では動かない。 */
export const isSyncingAtom = atom(
  (get) => get(feedSyncJobsAtom).data?.items.some(isFeedSyncActive) ?? false
)

/**
 * 件数(facets)。ヘッダーだけが購読するので、更新しても記事行は描き直されない。
 * hookが両方を返してpropsで配っていた頃は、ここが分けられなかった。
 */
export const articleFacetsAtomFamily = keyedAtomFamily(
  (search: ArticlesSearch) =>
    atomWithQuery(() => ({
      ...articleFacetsQueryOptions(search),
      staleTime: 30_000,
    })),
  searchKey
)
