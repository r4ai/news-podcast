import { QueryErrorResetBoundary } from "@tanstack/react-query"
import { CatchBoundary } from "@tanstack/react-router"
import { Suspense, type ReactNode } from "react"

import { recordBrowserEvent } from "@/shared/observability/events"
import { PanelError } from "./panel-error"
import { PanelSkeleton } from "./panel-skeleton"

type PanelProps = {
  /** 計測とリセットキーに使う安定した識別子。 */
  readonly name: string
  readonly fallback?: ReactNode
  readonly children: ReactNode
}

/**
 * 独立パネル単位の表示境界 (ADR-0018)。
 * 1つのパネルの取得失敗や読み込みが、他のパネルの表示と操作を止めない。
 *
 * 再試行はReactの境界とQueryのerror stateを対でリセットする。片方だけだと、
 * 境界は開き直るのにqueryはerrorのままなので、同じエラーが即座に再送出される。
 */
export function Panel({ name, fallback, children }: PanelProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset: resetQueries }) => (
        <CatchBoundary
          errorComponent={({ error, reset }) => (
            <PanelError
              error={error}
              reset={() => {
                resetQueries()
                reset()
              }}
            />
          )}
          getResetKey={() => name}
          onCatch={(error) =>
            recordBrowserEvent("panel.error", {
              "panel.name": name,
              "error.type":
                error instanceof Error ? error.name : "UnknownError",
            })
          }
        >
          <Suspense fallback={fallback ?? <PanelSkeleton />}>
            {children}
          </Suspense>
        </CatchBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
