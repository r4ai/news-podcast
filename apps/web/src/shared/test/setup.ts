import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

afterEach(() => {
  cleanup()
})

// openapi-fetchは baseUrl:"" の相対URLで Request を組み立てるが、
// Nodeの Request は相対URLを解決できない。jsdomのoriginを基準に補う。
const NodeRequest = globalThis.Request
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(
      typeof input === "string" && input.startsWith("/")
        ? new URL(input, window.location.origin)
        : input,
      init
    )
  }
} as typeof Request

// jsdomはmatchMediaを実装しないが、テーマ制御が起動時に参照する。
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}
