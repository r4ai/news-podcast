import { beforeEach, expect, test, vi } from "vitest"

const evaluationOrder = vi.hoisted(() => [] as string[])

vi.mock("@news-podcast/observability/node/register", () => ({
  getNodeObservability: () => {
    evaluationOrder.push("observability")
  },
}))

vi.mock("./node.js", () => {
  evaluationOrder.push("api")
  return {}
})

beforeEach(() => {
  evaluationOrder.length = 0
  vi.resetModules()
})

test("HTTP instrumentation starts before the API module is evaluated", async () => {
  await import("./bootstrap.js")

  expect(evaluationOrder).toEqual(["observability", "api"])
})
