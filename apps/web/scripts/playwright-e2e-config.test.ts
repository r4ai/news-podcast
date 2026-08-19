import { afterEach, describe, expect, it, vi } from "vitest"

const originalApiPort = process.env.E2E_API_PORT
const originalWebPort = process.env.E2E_WEB_PORT

afterEach(() => {
  vi.resetModules()
  restoreEnvironment("E2E_API_PORT", originalApiPort)
  restoreEnvironment("E2E_WEB_PORT", originalWebPort)
})

describe("Playwright E2E ports", () => {
  it("uses a dedicated API port that does not collide with Grafana", async () => {
    delete process.env.E2E_API_PORT
    delete process.env.E2E_WEB_PORT
    vi.resetModules()

    const { default: config } = await import("../playwright.e2e.config")
    const webServer = config.webServer as {
      readonly env?: Record<string, string>
    }

    expect(webServer.env).toMatchObject({
      E2E_API_PORT: "3310",
      E2E_WEB_PORT: "4273",
    })
  })

  it("keeps explicit port overrides for parallel and CI runs", async () => {
    process.env.E2E_API_PORT = "53101"
    process.env.E2E_WEB_PORT = "54274"
    vi.resetModules()

    const { default: config } = await import("../playwright.e2e.config")
    const webServer = config.webServer as {
      readonly env?: Record<string, string>
    }

    expect(webServer.env).toMatchObject({
      E2E_API_PORT: "53101",
      E2E_WEB_PORT: "54274",
    })
  })
})

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
