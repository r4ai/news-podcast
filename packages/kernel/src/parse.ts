import { Effect, Schema } from "effect"

import { deepFreeze } from "./deep-freeze.js"

const strictBoundaryOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const

/** The only supported path from unknown boundary input to trusted domain data. */
export const parse = <S extends Schema.Top>(schema: S) => {
  const decode = Schema.decodeUnknownEffect(schema, strictBoundaryOptions)
  return (input: unknown) => decode(input).pipe(Effect.map(deepFreeze))
}
