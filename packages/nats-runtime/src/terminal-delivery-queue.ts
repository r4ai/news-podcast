export type TerminalDeliveryQueue<Value> = Readonly<{
  offer: (value: Value) => Promise<void>
  terminate: (failure: unknown) => void
  receive: () => Promise<Value>
}>

/** A terminal transport failure takes precedence over buffered deliveries. */
export const createTerminalDeliveryQueue = <
  Value,
>(): TerminalDeliveryQueue<Value> => {
  const values: Value[] = []
  const waiters: Array<{
    resolve: (value: Value) => void
    reject: (failure: unknown) => void
  }> = []
  const producers: Array<{
    value: Value
    resolve: () => void
    reject: (failure: unknown) => void
  }> = []
  let terminal: unknown
  let terminated = false

  return Object.freeze({
    offer: async (value) => {
      if (terminated) return
      const waiter = waiters.shift()
      if (waiter !== undefined) {
        waiter.resolve(value)
        return
      }
      if (values.length === 0) {
        values.push(value)
        return
      }
      return new Promise<void>((resolve, reject) =>
        producers.push({ value, resolve, reject })
      )
    },
    terminate: (failure) => {
      if (terminated) return
      terminated = true
      terminal = failure
      values.length = 0
      for (const waiter of waiters.splice(0)) waiter.reject(failure)
      for (const producer of producers.splice(0)) producer.reject(failure)
    },
    receive: async () => {
      if (terminated) throw terminal
      if (values.length > 0) {
        const value = values.shift()!
        const producer = producers.shift()
        if (producer !== undefined) {
          values.push(producer.value)
          producer.resolve()
        }
        return value
      }
      return new Promise<Value>((resolve, reject) =>
        waiters.push({ resolve, reject })
      )
    },
  })
}
