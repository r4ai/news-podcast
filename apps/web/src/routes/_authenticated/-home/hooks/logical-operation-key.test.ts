import { describe, expect, it, vi } from "vitest"

import { LogicalOperationKey } from "./logical-operation-key"

describe("LogicalOperationKey", () => {
  it.each([
    {
      transition: "ambiguous retry",
      signatures: ["articles:a,b", "articles:a,b"],
      expected: ["key-1", "key-1"],
    },
    {
      transition: "selection changed",
      signatures: ["articles:a,b", "articles:a"],
      expected: ["key-1", "key-2"],
    },
  ])("handles $transition", ({ signatures, expected }) => {
    const nextKey = vi
      .fn()
      .mockReturnValueOnce("key-1")
      .mockReturnValueOnce("key-2")
    const operation = new LogicalOperationKey(nextKey)

    expect(signatures.map((signature) => operation.acquire(signature))).toEqual(
      expected
    )
  })

  it.each(["confirmed receipt", "dialog discarded", "explicit new action"])(
    "rotates after %s resets the operation",
    () => {
      const nextKey = vi
        .fn()
        .mockReturnValueOnce("key-1")
        .mockReturnValueOnce("key-2")
      const operation = new LogicalOperationKey(nextKey)

      expect(operation.acquire("same-input")).toBe("key-1")
      operation.reset()
      expect(operation.acquire("same-input")).toBe("key-2")
    }
  )
})
