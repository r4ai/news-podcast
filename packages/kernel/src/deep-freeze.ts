type Atomic = bigint | boolean | null | number | string | symbol | undefined

export type DeepReadonly<Value> = Value extends Atomic
  ? Value
  : Value extends (...arguments_: never[]) => unknown
    ? Value
    : Value extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value

const freeze = (value: object, seen: WeakSet<object>): void => {
  if (seen.has(value)) return
  seen.add(value)

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    const nested = descriptor?.value
    if (
      (typeof nested === "object" && nested !== null) ||
      typeof nested === "function"
    ) {
      freeze(nested, seen)
    }
  }

  Object.freeze(value)
}

/** Runtime companion to readonly domain types. Domain values never escape mutable. */
export const deepFreeze = <Value>(value: Value): DeepReadonly<Value> => {
  if (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) {
    freeze(value, new WeakSet())
  }
  return value as DeepReadonly<Value>
}
