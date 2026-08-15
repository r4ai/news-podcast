import { Cause, Effect } from "effect"

export type SequentialRpcLoopOptions<
  Value,
  ReceiveError,
  HandleError,
  SourceClosedError,
  Requirements,
> = Readonly<{
  receive: Effect.Effect<Value | undefined, ReceiveError, Requirements>
  handle: (value: Value) => Effect.Effect<void, HandleError, Requirements>
  sourceClosed: () => SourceClosedError
  onDeliveryFailure: (
    cause: Cause.Cause<HandleError>
  ) => Effect.Effect<void, never, Requirements>
}>

/**
 * Serializes mutations, isolates one delivery's failure, and treats source
 * termination as a runtime failure rather than a successful loop completion.
 */
export const runSequentialRpcLoop = <
  Value,
  ReceiveError,
  HandleError,
  SourceClosedError,
  Requirements,
>(
  options: SequentialRpcLoopOptions<
    Value,
    ReceiveError,
    HandleError,
    SourceClosedError,
    Requirements
  >
): Effect.Effect<never, ReceiveError | SourceClosedError, Requirements> =>
  Effect.gen(function* () {
    while (true) {
      const value = yield* options.receive
      if (value === undefined) return yield* Effect.fail(options.sourceClosed())
      yield* options
        .handle(value)
        .pipe(Effect.catchCause(options.onDeliveryFailure))
    }
  })

const redactCause = <Error>(cause: Cause.Cause<Error>) =>
  cause.reasons.map((reason) => {
    if (Cause.isFailReason(reason)) {
      const error = reason.error
      return {
        kind: "Fail",
        error_type:
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          typeof error._tag === "string"
            ? error._tag
            : typeof error,
      }
    }
    if (Cause.isDieReason(reason)) {
      return {
        kind: "Die",
        error_type:
          reason.defect instanceof Error ? reason.defect.name : "Defect",
      }
    }
    return { kind: "Interrupt" }
  })

/** Records failure metadata without request or reply payloads. */
export const logRpcDeliveryFailure = <Error>(
  service: string,
  scope: string,
  cause: Cause.Cause<Error>
) =>
  Effect.logError("rpc delivery isolated", {
    service,
    component: "nats-rpc",
    scope,
    error_type: "RpcDeliveryFailed",
    cause: JSON.stringify({ reasons: redactCause(cause) }),
  })
