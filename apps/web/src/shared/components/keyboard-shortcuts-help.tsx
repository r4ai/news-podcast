import { Keyboard } from "lucide-react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import {
  GLOBAL_SHORTCUT_HELP_KEY,
  SHORTCUT_GROUPS,
  type Shortcut,
} from "@/shared/lib/keyboard-shortcuts"
import { useGlobalKeydown } from "@/shared/lib/use-global-keydown"

/**
 * キーボード操作の目録と、その入口。
 *
 * 記事とライブラリには`j`/`k`/`o`/`s`/`e`/`u`/`/`が効くが、押せることを
 * 知らせる場所がどこにも無かった。知っている人だけが速く、知らない人には
 * 存在しない機能になっていた。
 *
 * 開閉の状態はこのcomponentが自分で持つ。`AppShell`へ持ち上げると、開くたびに
 * `AppShell`ごと、つまり表示中のページまで描き直される。
 *
 * 入口は2つ。`?`と、見えるボタン。キーだけにすると、そのキーを知らない人には
 * 一生届かない。
 */
export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false)

  // 開くだけ。閉じるのはdialogが持つEscapeと閉じるボタンで、ここは重ねない。
  // 開いている間はfocusがmodalの中にあり、`useGlobalKeydown`は素通しする。
  useGlobalKeydown((event) => {
    if (event.key !== GLOBAL_SHORTCUT_HELP_KEY) return
    event.preventDefault()
    setOpen(true)
  })

  return (
    <>
      <Button
        aria-label={`キーボード操作の一覧 (${GLOBAL_SHORTCUT_HELP_KEY})`}
        onClick={() => setOpen(true)}
        size="icon"
        variant="ghost"
      >
        <Keyboard aria-hidden="true" />
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>キーボード操作</DialogTitle>
            <DialogDescription>
              文字を入力している間は無効になります。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            {SHORTCUT_GROUPS.map((group) => (
              <section
                aria-labelledby={`shortcut-group-${group.title}`}
                key={group.title}
              >
                <h3
                  className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  id={`shortcut-group-${group.title}`}
                >
                  {group.title}
                </h3>
                {/*
                  「キー」と「何が起きるか」の対応表。`dl`で組むと、読み上げでも
                  対として読まれる。
                */}
                <dl className="flex flex-col gap-1.5">
                  {group.shortcuts.map((shortcut) => (
                    <ShortcutRow
                      key={shortcut.keys.join("+")}
                      shortcut={shortcut}
                    />
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ShortcutRow({ shortcut }: { readonly shortcut: Shortcut }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="flex shrink-0 gap-1">
        {shortcut.keys.map((key) => (
          <kbd
            className="min-w-6 rounded border border-b-2 bg-muted px-1.5 py-0.5 text-center font-mono text-xs"
            key={key}
          >
            {key}
          </kbd>
        ))}
      </dt>
      <dd className="text-sm text-muted-foreground">{shortcut.description}</dd>
    </div>
  )
}
