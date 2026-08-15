import { useEffect, useRef } from "react"

export type DebouncedCallback<Args extends readonly unknown[]> = {
  (...args: Args): void
  /** 待機中の呼び出しを今すぐ実行する。何も待っていなければ何もしない。 */
  readonly flush: () => void
  /** 待機中の呼び出しを破棄する。 */
  readonly cancel: () => void
}

export type DebounceOptions = {
  /**
   * unmount時に待機中の呼び出しを実行するか。
   * 自動保存のように「編集したのに保存されない」が事故になる用途でtrueにする。
   */
  readonly flushOnUnmount?: boolean
}

/**
 * 呼び出しを一定時間まとめる。デバウンスは「要求の頻度」を抑えるもので、
 * renderの優先度を下げる`useDeferredValue`とは別物。打鍵ごとにサーバへ
 * 投げたくない入力にだけ使う。
 *
 * タイマーというブラウザの資源をコンポーネントの生存期間に同期させるので、
 * ここはEffectとrefが正当な用途。呼び出し側にタイマー管理を漏らさない。
 */
export function useDebouncedCallback<Args extends readonly unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
  options: DebounceOptions = {}
): DebouncedCallback<Args> {
  const { flushOnUnmount = false } = options
  // 最新のcallbackとargsをrefで持つ。タイマー再生成なしに中身だけ差し替える。
  const latestRef = useRef(callback)
  latestRef.current = callback
  const pendingRef = useRef<{
    timer: ReturnType<typeof setTimeout>
    args: Args
  }>(undefined)
  const flushOnUnmountRef = useRef(flushOnUnmount)
  flushOnUnmountRef.current = flushOnUnmount

  const controlRef = useRef<DebouncedCallback<Args>>(undefined)
  if (!controlRef.current) {
    const cancel = () => {
      if (!pendingRef.current) return
      clearTimeout(pendingRef.current.timer)
      pendingRef.current = undefined
    }
    const flush = () => {
      const pending = pendingRef.current
      if (!pending) return
      clearTimeout(pending.timer)
      pendingRef.current = undefined
      latestRef.current(...pending.args)
    }
    const debounced = (...args: Args) => {
      cancel()
      pendingRef.current = {
        args,
        timer: setTimeout(() => {
          pendingRef.current = undefined
          latestRef.current(...args)
        }, delayMs),
      }
    }
    controlRef.current = Object.assign(debounced, { flush, cancel })
  }

  useEffect(() => {
    const control = controlRef.current
    return () => {
      if (flushOnUnmountRef.current) control?.flush()
      else control?.cancel()
    }
  }, [])

  return controlRef.current
}
