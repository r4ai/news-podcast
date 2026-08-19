/**
 * 開閉パネルの高さのtransition。
 *
 * 高さはBase UIが実測して配る`--collapsible-panel-height`へ掛ける。`auto`は
 * 補間できないので、開閉のたびにJSで高さを測る実装が要らなくなる。閉じた側の
 * 高さ0は`data-starting-style` / `data-ending-style`が受け持つ。
 *
 * `hidden`の除外は`hidden="until-found"`のためにある。畳んだ中身もブラウザの
 * ページ内検索から見つけられるよう、DOMには残したまま隠す。
 */
export const COLLAPSIBLE_PANEL_ANIMATION =
  "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none [&[hidden]:not([hidden='until-found'])]:hidden data-starting-style:h-0 data-ending-style:h-0"
