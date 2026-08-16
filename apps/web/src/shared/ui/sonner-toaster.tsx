import { useEffect } from "react"

import { Toaster, toast as sonnerToast } from "@workspace/ui/components/sonner"
import { useThemeValue } from "@/features/theme"

import { connectToastSink } from "./toast"

/**
 * sonnerの実体。`toast-host`から遅延読み込みされるので、このmoduleが評価
 * されること自体が「トーストが要求された」ことを意味する。
 *
 * テーマの購読はここで閉じる。アプリの根で読むと、テーマの切り替えが
 * router以下すべてを描き直す。
 */
export default function SonnerToaster() {
  const theme = useThemeValue()

  // sonnerの`toast()`は購読者、つまりマウント済みの`Toaster`がいなければ
  // 捨てられる。配送先を繋ぐのは描画が済んだ後でなければならない。外部
  // システムとの同期にあたるので、ここはEffectが正しい置き場になる。
  useEffect(() => {
    connectToastSink(({ kind, message }) => sonnerToast[kind](message))
  }, [])

  return <Toaster theme={theme} />
}
