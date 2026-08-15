import { describe, expect, it } from "vitest"

import { routeApiDocs } from "./api-docs.js"

describe("API documentation router", () => {
  it.each([
    ["GET", "/docs", 200, "text/html", true],
    ["HEAD", "/docs", 200, "text/html", false],
    ["GET", "/openapi.json?download=1", 200, "application/json", true],
    ["HEAD", "/openapi.json", 200, "application/json", false],
  ] as const)(
    "%s %s returns the expected representation",
    async (method, path, status, contentType, hasBody) => {
      const response = routeApiDocs(
        new Request(`http://gateway.test${path}`, { method })
      )

      expect(response?.status).toBe(status)
      expect(response?.headers.get("content-type")).toContain(contentType)
      expect((await response?.text()) !== "").toBe(hasBody)
    }
  )

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects %s without invoking the API runtime",
    (method) => {
      const response = routeApiDocs(
        new Request("http://gateway.test/docs", { method })
      )

      expect(response?.status).toBe(405)
      expect(response?.headers.get("allow")).toBe("GET, HEAD")
    }
  )

  it("leaves unrelated paths to the API runtime", () => {
    expect(
      routeApiDocs(new Request("http://gateway.test/v1/episode-jobs"))
    ).toBeUndefined()
  })
})
