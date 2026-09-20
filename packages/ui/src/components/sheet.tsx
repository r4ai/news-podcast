"use client"

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { useEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

/*
  ADR-0018で新規primitiveは慎重に増やす方針。

  画面下端から立ち上がる面が要る。`Dialog`は画面の中央に置く前提で、下端から
  の滑り込み・掴み代・safe areaのいずれも持たない。狭い幅では、中央のdialogは
  «どこから来て、どこへ戻るのか» が判らないまま画面を覆うので、来た方向が
  見える面を別に用意する。

  土台は`Dialog`と同じBase UIの`Dialog`。modalの作法(focus trap・Escape・
  背面の不活性化)はそちらに任せ、ここは置き方と動きだけを決める。
*/
function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

/** ここまで引き下げたら閉じる。これ未満は「掴んで戻した」として元へ返す。 */
const DISMISS_PX = 96

/** 指が動いたと見なす幅。これ未満は押しただけなので、押した通りに閉じる。 */
const DRAG_SLOP_PX = 4

/** 引き切った後、離した位置から下へ送り出すのにかける時間。 */
const DISMISS_MS = 300

/** 動きを止める設定か。設定は読み取り専用なので、必要なときに読めばよい。 */
function prefersReducedMotion(): boolean {
  return (
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

function SheetContent({
  children,
  className,
  onDismiss,
  ...props
}: SheetPrimitive.Popup.Props & {
  /**
   * 掴み代から閉じるときに呼ぶ。
   *
   * 開いているかどうかを持っているのは`Root`を置いた側なので、面の中からは
   * 直接閉じられない。`Close`を隠し持って押す手も試したが、`display:none`の
   * 要素への`click()`は届かなかった(実測)。閉じる道は明示で受け取る。
   */
  readonly onDismiss: () => void
}) {
  /*
    掴んで引き下げて閉じる。

    掴み代を描くだけで手を付けないと、**引けそうに見えて引けない**面になる。
    掴み代は同時に「閉じる」ボタンでもあるので、押しても閉じる。どちらも
    効かない経路(キーボード)にはEscapeと背面の押下が残る。
  */
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  /** 引き切った後、その位置から下へ送り出している最中か。 */
  const [dismissing, setDismissing] = useState(false)
  const startY = useRef(0)
  /*
    引いた量は`ref`でも持つ。`state`だけだと、離した時点で最後の動きがまだ
    描き直されておらず、判断が1フレーム古い値になる。
  */
  const moved = useRef(0)
  // 引いて戻したときに、続けて飛んでくる`click`を無視するための印。
  const dragged = useRef(false)
  /** 引き始めた指。触れているのが1本とは限らない。 */
  const pointer = useRef<number | null>(null)
  /** 掴み代そのもの。指がこの上で離れたかどうかを見る。 */
  const handleRef = useRef<HTMLButtonElement>(null)

  /*
    動きと終わりは**窓で受ける**。掴み代の上だけで受けると、指が要素の外へ
    出た瞬間や、ブラウザが自前の引きずりを始めて`pointercancel`を投げた
    瞬間に、引いた量を見失う。`setPointerCapture`でも同じことが起きた(実測:
    160px引いても閉じなかった)。

    窓で受ける代わりに、**引き始めた指以外は無視する**。そうしないと、1本目
    が掴み代を押さえたまま2本目を動かしただけで面が動き、2本目を離した拍子に
    閉じてしまう。
  */
  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer.current) return
      moved.current = Math.max(0, event.clientY - startY.current)
      setOffset(moved.current)
    }
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointer.current) return
      const distance = moved.current
      const canceled = event.type === "pointercancel"
      pointer.current = null
      moved.current = 0
      setDragging(false)
      /*
        印を立てるのは、**続けて`click`が来ると判っているときだけ**。

        打ち切られた指の後にも、掴み代の外で離れた指の後にも`click`は来ない。
        そこで立てたままにすると、次にキーボードや支援技術で閉じるボタンを
        押したとき、その印を食べて何も起きない。押し直しでは降ろせない
        (押下を伴わないため)。
      */
      dragged.current =
        !canceled &&
        distance > DRAG_SLOP_PX &&
        handleRef.current?.contains(event.target as Node) === true
      if (!canceled && distance >= DISMISS_PX) {
        // 離した位置から続けて下へ送り出す。0へ戻すと、一度跳ね上がる。
        setDismissing(true)
        onDismiss()
        /*
          送り出しが終わったら印を降ろす。この面は閉じても**component
          としては残る**ので、降ろさないと次に開いたときも画面外へ寄った
          まま立ち上がり、背面だけを塞ぐ見えない面になる
          (実測: 開き直した中身のviewport比が0)。
        */
        globalThis.setTimeout(
          () => {
            setDismissing(false)
            /*
            引き代も戻す。残したままだと、開き直して掴み代を押した瞬間
            (まだ指が動く前) に`dragging`が立ち、前回引いた分だけ面が
            いきなり下へ飛ぶ。
          */
            setOffset(0)
          },
          prefersReducedMotion() ? 0 : DISMISS_MS + 50
        )
        return
      }
      setOffset(0)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
  }, [dragging, onDismiss])

  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 isolate z-50 bg-black/30 duration-300 ease-apple supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:duration-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        style={
          dragging
            ? { transform: `translateY(${offset}px)`, transition: "none" }
            : dismissing
              ? {
                  transform: "translateY(100%)",
                  /*
                    動きを止める設定では送り出しも止める。`class`側の
                    `motion-reduce:duration-0`はこのinline styleに勝てない。
                  */
                  transition: prefersReducedMotion()
                    ? "none"
                    : `transform ${DISMISS_MS}ms var(--ease-apple)`,
                }
              : undefined
        }
        className={cn(
          /*
            高さは画面の9割まで。超える分は**この面の中でスクロールさせる**。
            背面はmodalが固めているので、溢れた分は行き場が無くなる。字を
            大きくした環境や、極端に低いviewportで起きる。
          */
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground outline-none",
          // 来た方向が見えるよう、下端から丸ごと滑り込ませる。
          "duration-350 ease-apple data-open:animate-in data-open:slide-in-from-bottom-[100%] data-closed:animate-out data-closed:slide-out-to-bottom-[100%] motion-reduce:duration-0",
          // 引いて閉じるときは、上の出口の動きを止めて離した位置から続ける。
          dismissing && "data-closed:animate-none",
          className
        )}
        {...props}
      >
        {/*
          掴み代。引き下げても押しても閉じる。見た目の棒は9pxしかないので、
          指で掴める広さは外側のボタンが持つ。
        */}
        <button
          aria-label="閉じる"
          className="sticky top-0 z-10 mx-auto flex w-24 shrink-0 cursor-grab touch-none items-center justify-center rounded-full py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
          onClick={() => {
            // 引いて戻した直後の`click`は、押したことにしない。
            if (dragged.current) {
              dragged.current = false
              return
            }
            onDismiss()
          }}
          draggable={false}
          ref={handleRef}
          onPointerDown={(event) => {
            /*
              印は**次に押し始めた時点で必ず消す**。同じ操作の`click`が来る
              前提で消していると、指が要素の外で離れた場合や打ち切られた
              場合に立ちっぱなしになり、その次の押下を食べて何も起きない。
            */
            dragged.current = false
            setDismissing(false)
            setOffset(0)
            if (event.button !== 0 || pointer.current !== null) return
            pointer.current = event.pointerId
            startY.current = event.clientY
            moved.current = 0
            setDragging(true)
          }}
          type="button"
        >
          <span
            aria-hidden="true"
            className="h-1 w-9 rounded-full bg-foreground/20"
          />
        </button>
        {children}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
}
