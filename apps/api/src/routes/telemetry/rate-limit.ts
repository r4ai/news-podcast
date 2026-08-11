/** owner毎に1分60リクエストへ絞る、単純な固定窓レートリミッタ。 */
export function createTelemetryRateLimiter() {
  const requests = new Map<string, { count: number; resetAt: number }>()
  return function consume(ownerId: string, now = Date.now()): boolean {
    const current = requests.get(ownerId)
    if (!current || current.resetAt <= now) {
      requests.set(ownerId, { count: 1, resetAt: now + 60_000 })
      return true
    }
    current.count += 1
    return current.count <= 60
  }
}
