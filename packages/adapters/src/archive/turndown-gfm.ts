import type TurndownService from "turndown"

// `turndown-plugin-gfm` は型定義を同梱しておらず、`@types/...` も存在しない。
// アンビエント宣言ファイルにするとpackages/adapters以外のtsconfigから拾えず、
// apps/worker側の型検査で解決できなくなるため、ここで型を付け直して再輸出する。
// eslint-disable-next-line
// @ts-expect-error 型定義が存在しないモジュール
import { gfm as untypedGfm } from "turndown-plugin-gfm"

/** GFM拡張（表・打ち消し線・タスクリスト）をturndownへ登録する。 */
export const gfm = untypedGfm as (service: TurndownService) => void
