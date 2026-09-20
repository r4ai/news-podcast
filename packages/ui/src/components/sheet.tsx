"use client"

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

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

function SheetContent({
  children,
  className,
  ...props
}: SheetPrimitive.Popup.Props) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 isolate z-50 bg-black/30 duration-300 ease-apple supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:duration-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-4 rounded-t-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground outline-none",
          // 来た方向が見えるよう、下端から丸ごと滑り込ませる。
          "duration-350 ease-apple data-open:animate-in data-open:slide-in-from-bottom-[100%] data-closed:animate-out data-closed:slide-out-to-bottom-[100%] motion-reduce:duration-0",
          className
        )}
        {...props}
      >
        {/* 掴み代。押し下げて閉じられることを、字を使わずに示す。 */}
        <div
          aria-hidden="true"
          className="mx-auto h-1 w-9 shrink-0 rounded-full bg-foreground/20"
        />
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
