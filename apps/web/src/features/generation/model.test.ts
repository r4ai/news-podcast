import { describe, expect, it } from "vitest"

import { failureMessage, stageLabel, statusLabel } from "./model"

describe("generation display model", () => {
  it("maps retry and pipeline states without losing contract exhaustiveness", () => {
    expect(statusLabel("retrying")).toBe("再試行待ち")
    expect(stageLabel("synthesizing_audio")).toBe("音声を生成中")
  })

  it("keeps operational failure codes separate from user-facing copy", () => {
    expect(
      failureMessage({ code: "attempt-limit-exceeded", message: "internal" })
    ).toContain("上限4回")
    expect(failureMessage({ code: "unknown", message: "fallback" })).toBe(
      "fallback"
    )
  })
})
