export type BrowserEventName =
  | "audio.completed"
  | "audio.error"
  | "audio.started"
  | "episode.requested"
  | "login.result"
  | "panel.error"
  | "route.error"
  | "schedule.changed"
  | "subscription.changed"

export type BrowserEventAttributes = Readonly<
  Record<string, string | number | boolean>
>

type Recorder = (
  name: BrowserEventName,
  attributes: BrowserEventAttributes
) => void

let recorder: Recorder | undefined
const pending: Array<readonly [BrowserEventName, BrowserEventAttributes]> = []

export function recordBrowserEvent(
  name: BrowserEventName,
  attributes: BrowserEventAttributes = {}
): void {
  if (recorder) {
    recorder(name, attributes)
    return
  }
  if (pending.length === 20) pending.shift()
  pending.push([name, attributes])
}

export function installBrowserEventRecorder(next: Recorder): void {
  recorder = next
  for (const [name, attributes] of pending.splice(0)) next(name, attributes)
}
