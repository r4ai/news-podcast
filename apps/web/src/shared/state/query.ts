import type { Atom } from "jotai"
import { atomFamily } from "jotai/utils"

/**
 * server stateをatomとして扱うための土台。
 *
 * 取得・鮮度・invalidationはTanStack Queryが持ったまま (ADR-0047)、その結果を
 * atomとして配る。componentが「必要な一部分だけ」を購読できるのが狙いで、
 * 例えば件数(facets)が更新されても、それを購読していない記事行は描き直され
 * ない。hookが結果を丸ごと返してpropsで配ると、この分離はできない。
 *
 * `queryOptions`は`openapi-fetch`の型付き定義 (`api.queryOptions`) をそのまま
 * 渡せるので、OpenAPIの契約から来る型はこの薄い包みを通しても失われない。
 */

/**
 * 引数を取るqueryのatomを、引数の**値**で使い回す。
 *
 * 絞り込み条件のような物体をそのまま鍵にすると、renderのたびに別物と見なされて
 * atomが作り直され、購読も張り直しになる。何をもって同じ引数とするかを
 * `key`で明示する。
 */
export function keyedAtomFamily<Param, AtomType extends Atom<unknown>>(
  create: (param: Param) => AtomType,
  key: (param: Param) => string
) {
  return atomFamily(create, (a, b) => key(a) === key(b))
}

export {
  atomWithMutation,
  atomWithQuery,
  atomWithSuspenseInfiniteQuery,
  atomWithSuspenseQuery,
  queryClientAtom,
} from "jotai-tanstack-query"
