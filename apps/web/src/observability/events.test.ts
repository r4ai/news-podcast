import { describe, expect, it, vi } from "vitest"

import { installBrowserEventRecorder, recordBrowserEvent } from "./events"

describe("browser telemetry event buffer", () => {
  it("flushes at most the latest twenty events after lazy SDK startup", () => {
    for (let index = 0; index < 25; index += 1) {
      recordBrowserEvent("audio.started", { status: index })
    }
    const recorder = vi.fn()
    installBrowserEventRecorder(recorder)

    expect(recorder).toHaveBeenCalledTimes(20)
    expect(recorder.mock.calls[0]?.[1]).toEqual({ status: 5 })
    expect(recorder.mock.calls.at(-1)?.[1]).toEqual({ status: 24 })
  })
})
