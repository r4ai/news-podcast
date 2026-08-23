/**
 * Binds one idempotency key to a logical UI operation until its receipt is
 * confirmed or the operation is explicitly discarded.
 */
export class LogicalOperationKey {
  private current?: { readonly signature: string; readonly key: string }
  private readonly nextKey: () => string

  constructor(nextKey: () => string) {
    this.nextKey = nextKey
  }

  acquire(signature: string): string {
    if (this.current?.signature === signature) return this.current.key
    const key = this.nextKey()
    this.current = { signature, key }
    return key
  }

  reset(): void {
    this.current = undefined
  }
}
