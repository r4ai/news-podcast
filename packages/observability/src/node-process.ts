import type { Observability } from "./contract.js"

const FATAL_SHUTDOWN_TIMEOUT_MS = 5_000

export interface ProcessErrorListenerDependencies {
  readonly scheduleFallback?: (
    callback: () => void,
    delayMs: number
  ) => () => void
}

/**
 * `uncaughtException` / `unhandledRejection` を構造化logとmetricで捕捉し、
 * telemetryをflushしてからプロセスを終了させる。fenceとleaseで保護された
 * 有界実行（ADR-0016）を前提に、クラッシュ要因をtrace付きで残す。
 */
export function installProcessErrorListeners(
  observability: Observability,
  exit: (code: number) => void = (code) => process.exit(code),
  dependencies: ProcessErrorListenerDependencies = {}
): () => void {
  const scheduleFallback =
    dependencies.scheduleFallback ?? defaultScheduleFallback
  let handlingFatalError = false
  let exited = false

  const exitOnce = (): void => {
    if (exited) return
    exited = true
    exit(1)
  }

  const handleFatalError = (record: () => void): void => {
    if (handlingFatalError) return
    handlingFatalError = true
    let cancelFallback: () => void
    try {
      cancelFallback = scheduleFallback(exitOnce, FATAL_SHUTDOWN_TIMEOUT_MS)
    } catch {
      exitOnce()
      return
    }
    try {
      record()
    } catch {
      // A broken telemetry path must not prevent termination after a fatal error.
    }
    void Promise.resolve()
      .then(() => observability.shutdown())
      .catch(() => undefined)
      .finally(() => {
        cancelFallback()
        exitOnce()
      })
  }

  const onUncaught = (error: Error): void => {
    handleFatalError(() => {
      observability.log({
        name: "process.uncaught_exception",
        level: "error",
        error,
      })
      observability.count("process.error", 1, {
        "error.source": "uncaught_exception",
        "error.type": error.name || "Error",
      })
    })
  }
  const onUnhandled = (reason: unknown): void => {
    handleFatalError(() => {
      observability.log({
        name: "process.unhandled_rejection",
        level: "error",
        error: reason instanceof Error ? reason : new Error(String(reason)),
      })
      observability.count("process.error", 1, {
        "error.source": "unhandled_rejection",
      })
    })
  }
  process.on("uncaughtException", onUncaught)
  process.on("unhandledRejection", onUnhandled)
  return () => {
    process.off("uncaughtException", onUncaught)
    process.off("unhandledRejection", onUnhandled)
  }
}

function defaultScheduleFallback(
  callback: () => void,
  delayMs: number
): () => void {
  const timeout = setTimeout(callback, delayMs)
  timeout.unref()
  return () => clearTimeout(timeout)
}
