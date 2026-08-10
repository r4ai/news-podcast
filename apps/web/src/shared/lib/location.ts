/** 現在のURLのpath+search+hash。ログイン後の復帰先として使う。 */
export function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}
