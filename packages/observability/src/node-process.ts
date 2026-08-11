import type { Observability } from "./contract.js"

/**
 * `uncaughtException` / `unhandledRejection` を構造化logとmetricで捕捉し、
 * telemetryをflushしてからプロセスを終了させる。fenceとleaseで保護された
 * 有界実行（ADR-0016）を前提に、クラッシュ要因をtrace付きで残す。
 */
export function installProcessErrorListeners(
  observability: Observability,
  exit: (code: number) => void = (code) => process.exit(code)
): () => void {
  const onUncaught = (error: Error): void => {
    observability.log({
      name: "process.uncaught_exception",
      level: "error",
      error,
    })
    observability.count("process.error", 1, {
      "error.source": "uncaught_exception",
      "error.type": error.name || "Error",
    })
    void observability.shutdown().finally(() => exit(1))
  }
  const onUnhandled = (reason: unknown): void => {
    observability.log({
      name: "process.unhandled_rejection",
      level: "error",
      error: reason instanceof Error ? reason : new Error(String(reason)),
    })
    observability.count("process.error", 1, {
      "error.source": "unhandled_rejection",
    })
    void observability.shutdown().finally(() => exit(1))
  }
  process.on("uncaughtException", onUncaught)
  process.on("unhandledRejection", onUnhandled)
  return () => {
    process.off("uncaughtException", onUncaught)
    process.off("unhandledRejection", onUnhandled)
  }
}
