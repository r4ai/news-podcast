import { useAtomValue, useSetAtom, type PrimitiveAtom } from "jotai"
import type { ComponentProps } from "react"

import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"

/**
 * 下書きをatomから読み書きする入力欄。
 *
 * 入力欄の値を親のstateに持たせると、打鍵のたびに親から下がすべて描き直される。
 * 一覧を含むパネルなら、1文字ごとに全行が巻き添えになる。値の持ち主をatomに
 * すれば、購読しているのは入力欄だけなので描き直しもそこで止まる。
 *
 * 送信時に値が要る側は`useStore().get(atom)`で読む。購読しないので、打鍵で
 * 呼び出し側が描き直されることはない。
 */
export type AtomInputProps = {
  readonly atom: PrimitiveAtom<string>
} & Omit<ComponentProps<typeof Input>, "value" | "onChange">

export function AtomInput({ atom, ...props }: AtomInputProps) {
  const value = useAtomValue(atom)
  const setValue = useSetAtom(atom)

  return (
    <Input
      onChange={(event) => setValue(event.target.value)}
      value={value}
      {...props}
    />
  )
}

export type AtomTextareaProps = {
  readonly atom: PrimitiveAtom<string>
} & Omit<ComponentProps<typeof Textarea>, "value" | "onChange">

export function AtomTextarea({ atom, ...props }: AtomTextareaProps) {
  const value = useAtomValue(atom)
  const setValue = useSetAtom(atom)

  return (
    <Textarea
      onChange={(event) => setValue(event.target.value)}
      value={value}
      {...props}
    />
  )
}
