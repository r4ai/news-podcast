/** Always refreshes the job list and returns, rather than throws, the first failure. */
export async function settleJobAction(
  request: () => Promise<unknown>,
  refresh: () => Promise<unknown>
): Promise<unknown | undefined> {
  let failure: unknown
  try {
    await request()
  } catch (error) {
    failure = error
  }
  try {
    await refresh()
  } catch (error) {
    failure ??= error
  }
  return failure
}
