/** Fixed windows retain every charged key until expiry; cycling keys cannot evict a budget. */
export const makeTelemetryAdmission = (now: () => number) => {
  type Window = { expires: number; count: number }
  const windows = new Map<string, Window>()
  let active = 0
  const take = (key: string, maximum: number) => {
    const time = now()
    for (const [key, window] of windows)
      if (window.expires <= time) windows.delete(key)
    let window = windows.get(key)
    if (!window) {
      if (windows.size >= 1_000) return false
      window = { expires: time + 60_000, count: 0 }
      windows.set(key, window)
    }
    if (window.count >= maximum) return false
    window.count++
    return true
  }
  return {
    enter: (peer: string) => {
      if (!take("global", 300) || !take(`ip:${peer}`, 120) || active >= 8)
        return false
      active++
      return true
    },
    owner: (owner: string) => take(`owner:${owner}`, 30),
    leave: () => {
      active--
    },
  }
}
