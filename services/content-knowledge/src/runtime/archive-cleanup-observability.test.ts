import { describe, expect, it, vi } from "vitest"

import { makeArchiveCleanupObserver } from "./archive-cleanup-observability.js"

describe("archive cleanup observability", () => {
  it("records asset budget limits without URL or owner labels", () => {
    const count = vi.fn()
    const log = vi.fn()
    makeArchiveCleanupObserver({ count, log }).assets?.({
      attempted: 2,
      downloadedBytes: 6,
      retainedBytes: 3,
      limit: "total_bytes",
    })
    expect(count).toHaveBeenCalledWith("archive.assets.limit", 1, {
      reason: "total_bytes",
    })
    expect(count).toHaveBeenCalledWith("archive.assets.downloaded_bytes", 6)
    expect(log).toHaveBeenCalledWith({
      name: "archive.assets.budget",
      level: "warn",
      attributes: {
        attempted: 2,
        downloadedBytes: 6,
        retainedBytes: 3,
        limit: "total_bytes",
      },
    })
  })
  it("counts and logs best-effort deletion failures without object keys", () => {
    const count = vi.fn()
    const log = vi.fn()
    const observer = makeArchiveCleanupObserver({ count, log })

    observer.cleanup({
      trigger: "capture_failure",
      attempted: 3,
      deleted: 2,
      failed: 1,
    })

    expect(count).toHaveBeenCalledWith("object.cleanup", 2, {
      "cleanup.result": "deleted",
      trigger: "capture_failure",
    })
    expect(count).toHaveBeenCalledWith("object.cleanup", 1, {
      "cleanup.result": "failed",
      trigger: "capture_failure",
    })
    expect(log).toHaveBeenCalledWith({
      name: "object.cleanup.failed",
      level: "warn",
      attributes: {
        trigger: "capture_failure",
        "cleanup.attempted": 3,
        "cleanup.deleted": 2,
        "cleanup.failed": 1,
      },
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain("articles/")
  })
})

it("counts card metadata outcomes without destination labels", () => {
  const count = vi.fn()
  const log = vi.fn()
  const observer = makeArchiveCleanupObserver({ count, log })
  observer.linkCard?.("succeeded")
  observer.linkCard?.("unavailable")
  expect(count.mock.calls).toEqual([
    ["archive.link_card", 1, { result: "succeeded" }],
    ["archive.link_card", 1, { result: "unavailable" }],
  ])
})
