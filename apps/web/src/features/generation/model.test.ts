import { describe, expect, it } from "vitest"

import { stageLabel, statusLabel } from "./model"

describe("generation display model", () => {
  it("maps retry and pipeline states without losing contract exhaustiveness", () => {
    expect(statusLabel("retrying")).toBe("再試行待ち")
    expect(stageLabel("synthesizing_audio")).toBe("音声を生成中")
  })
})
