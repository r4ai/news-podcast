/**
 * LIKE のワイルドカードを打ち消す。利用者の入力がパターンとして
 * 解釈されると、検索結果が静かに広がる。
 */
export const escapeLikePattern = (input: string): string =>
  input.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
