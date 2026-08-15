export type DrainableNatsConnection = Readonly<{
  drain: () => Promise<void>
  close: () => Promise<void>
}>

/** Bounds graceful drain so a broken transport cannot block process exit. */
export const drainNatsConnection = async (
  connection: DrainableNatsConnection,
  timeoutMillis = 1_000
): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const drained = await Promise.race([
    connection
      .drain()
      .then(() => true)
      .catch(() => false),
    new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMillis)
    }),
  ])
  if (timeout !== undefined) clearTimeout(timeout)
  if (!drained) await connection.close()
}
