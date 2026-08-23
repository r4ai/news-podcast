/** ブラウザのタブ・履歴・ブックマークに残る名前。 */
export const APP_NAME = "News Podcast"

/**
 * ページの名前をタブの題へ組む。
 *
 * どのページでも同じ題だと、タブを並べたときも履歴を辿るときも見分けが付かず、
 * 読み上げでも移動先が伝わらない。ページの名前を先に置き、アプリ名は後ろへ回す
 * (タブが細くなると末尾から削られる)。
 */
export function pageTitle(name: string): string {
  return `${name} | ${APP_NAME}`
}
