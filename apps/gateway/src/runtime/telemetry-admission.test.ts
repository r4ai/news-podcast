import { expect, it } from "vitest"
import { makeTelemetryAdmission } from "./telemetry-admission.js"

it("bounds parallel work and releases capacity", () => {
  const admission = makeTelemetryAdmission(() => 0)
  for (let i = 0; i < 8; i++) expect(admission.enter("ip")).toBe(true)
  expect(admission.enter("ip")).toBe(false)
  admission.leave()
  expect(admission.enter("ip")).toBe(true)
})
it("global budget survives IP/owner rotation and resets at its deadline", () => {
  let now = 0
  const admission = makeTelemetryAdmission(() => now)
  for (let i = 0; i < 300; i++) {
    expect(admission.enter(String(i))).toBe(true)
    expect(admission.owner(String(i))).toBe(true)
    admission.leave()
  }
  expect(admission.enter("new")).toBe(false)
  now = 59_999
  expect(admission.enter("new")).toBe(false)
  now = 60_000
  expect(admission.enter("new")).toBe(true)
})
it("does not evict active keys when its bounded table fills", () => {
  let now = 0
  const admission = makeTelemetryAdmission(() => now)
  for (let i = 0; i < 1_000; i++) expect(admission.owner(String(i))).toBe(true)
  expect(admission.owner("new")).toBe(false)
  for (let i = 0; i < 29; i++) expect(admission.owner("0")).toBe(true)
  expect(admission.owner("0")).toBe(false)
  now = 60_000
  expect(admission.owner("new")).toBe(true)
})
