import { atom } from "jotai"
import { selectAtom } from "jotai/utils"

import {
  emptyGenerationStream,
  sameAdoptedArticles,
  sameJobFailure,
  type GenerationStream,
  type JobStage,
} from "./model"

/**
 * 生成中のAG-UIストリームを畳み込んだ結果。
 *
 * 生成は数分かかり、その間ずっと毎秒フレームが届く。1つのhookがこの状態を
 * 抱えてpropsで配ると、1フレームごとに「購読フィード」「最新エピソード」
 * 「記事選択ダイアログ」まで巻き添えで描き直される (実測: 3フレームで3回)。
 * 値の持ち主をatomにして、購読を読む場所まで下ろす (ADR-0060)。
 *
 * 書き込むのは`useGenerationStream`だけ。読む側は下の派生atomを使う。
 */
export const generationStreamAtom = atom<GenerationStream>(
  emptyGenerationStream
)

/**
 * 以下は`selectAtom`による切り出し。選んだ値が前回と等しければ購読側は
 * 動かないので、「そのcomponentが実際に描くもの」だけが再描画の条件になる。
 */

/** 作業実況。reducerは変化が無ければ同じ配列を返すので参照比較で足りる。 */
export const generationTimelineAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.timeline
)

/** 採用記事。`STATE_SNAPSHOT`が毎回作り直すので、中身で同一性を決める。 */
export const generationAdoptedArticlesAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.adoptedArticles,
  sameAdoptedArticles
)

/**
 * このストリームがどのジョブのものか。
 *
 * 購読の張り替えはEffectなので、最新ジョブが変わってから空へ戻るまでに
 * 1描画の隙がある。読む側はこのidを今のジョブと突き合わせ、一致しない値は
 * 使わない。cleanupで空へ戻すのと合わせて、前のジョブの状態が出る窓を塞ぐ。
 */
export const generationStreamJobIdAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.jobId
)

/** SSEが繋がっているか。ポーリングへ落とすかの判断に使う。 */
export const generationConnectedAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.connected
)

/** 終端に達したか。ジョブとエピソードの取り直しの契機。 */
export const generationFinishedAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.finished
)

/** ストリームが伝える状態。文字列なので、同じ状態が続く限り動かない。 */
export const generationLiveStatusAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.state?.status
)

/** 成功snapshotが伝えるEpisode。statusと同じlive stateから読む。 */
export const generationLiveEpisodeIdAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.state?.episodeId ?? undefined
)

export const generationLiveStageAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.state?.currentStage as JobStage | undefined
)

export const generationLiveFailureAtom = selectAtom(
  generationStreamAtom,
  (stream) => stream.state?.failure ?? undefined,
  sameJobFailure
)
