import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useMermaidRender } from "./use-mermaid-render"

const initialize = vi.fn()
const render = vi.fn()

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => render(...args),
  },
}))

describe("useMermaidRender", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns the rendered svg once mermaid resolves", async () => {
    render.mockResolvedValueOnce({ svg: "<svg>ok</svg>" })

    const { result } = renderHook(() =>
      useMermaidRender("graph TD;A-->B;", false)
    )

    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current).toMatchObject({ svg: "<svg>ok</svg>" })
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", theme: "base" })
    )
  })

  it("surfaces a syntax error without throwing", async () => {
    render.mockRejectedValueOnce(new Error("Parse error"))

    const { result } = renderHook(() => useMermaidRender("not mermaid", false))

    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(result.current).toMatchObject({ message: "Parse error" })
  })
})
