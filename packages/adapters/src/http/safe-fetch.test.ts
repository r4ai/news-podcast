import { describe, expect, it } from "vitest"

import { assertSafePublicUrl } from "./safe-fetch.js"

describe("assertSafePublicUrl", () => {
  it.each([
    "http://127.0.0.1/private",
    "http://10.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/private",
    "file:///etc/passwd",
  ])("rejects non-public URL %s", async (url) => {
    await expect(assertSafePublicUrl(url)).rejects.toThrow()
  })

  it("accepts a public HTTP address", async () => {
    await expect(
      assertSafePublicUrl("https://93.184.216.34/article")
    ).resolves.toEqual(new URL("https://93.184.216.34/article"))
  })
})
