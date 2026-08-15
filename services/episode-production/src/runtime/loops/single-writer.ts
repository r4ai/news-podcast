import {
  logRpcDeliveryFailure,
  runSequentialRpcLoop,
} from "@news-podcast/nats-runtime"
import { Effect } from "effect"

export type SingleWriterSource<Value, ReceiveError> = Readonly<{
  readonly receive: Effect.Effect<Value | undefined, ReceiveError>
}>

/** Receives the next item only after the previous mutation has completed. */
export const runSingleWriterLoop = <
  Value,
  ReceiveError,
  HandleError,
  SourceClosedError,
  Requirements,
>(
  source: SingleWriterSource<Value, ReceiveError>,
  handle: (value: Value) => Effect.Effect<void, HandleError, Requirements>,
  sourceClosed: () => SourceClosedError,
  scope: string
): Effect.Effect<never, ReceiveError | SourceClosedError, Requirements> =>
  runSequentialRpcLoop({
    receive: source.receive,
    handle,
    sourceClosed,
    onDeliveryFailure: (cause) =>
      logRpcDeliveryFailure("episode-production", scope, cause),
  })
