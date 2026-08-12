import { Effect } from "effect"

export type SingleWriterSource<Value, ReceiveError> = Readonly<{
  readonly receive: Effect.Effect<Value | undefined, ReceiveError>
}>

/** Receives the next item only after the previous mutation has completed. */
export const runSingleWriterLoop = <
  Value,
  ReceiveError,
  HandleError,
  Requirements,
>(
  source: SingleWriterSource<Value, ReceiveError>,
  handle: (value: Value) => Effect.Effect<void, HandleError, Requirements>
): Effect.Effect<void, ReceiveError | HandleError, Requirements> =>
  Effect.gen(function* () {
    while (true) {
      const value = yield* source.receive
      if (value === undefined) return
      yield* handle(value)
    }
  })
