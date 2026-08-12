import { beforeEach, expect, test, vi } from "vitest"

const evaluationOrder = vi.hoisted(() => [] as string[])

vi.mock("@news-podcast/observability/node/register", () => ({
  getNodeObservability: () => {
    evaluationOrder.push("observability")
  },
}))

vi.mock("./node.js", () => {
  evaluationOrder.push("episode-library")
  return {}
})

beforeEach(() => {
  evaluationOrder.length = 0
  vi.resetModules()
})

test("OTel starts before the Episode Library composition root loads", async () => {
  await import("./bootstrap.js")

  expect(evaluationOrder).toEqual(["observability", "episode-library"])
})
