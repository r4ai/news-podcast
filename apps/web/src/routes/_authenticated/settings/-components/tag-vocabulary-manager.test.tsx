import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TagVocabularyManagerView } from "./tag-vocabulary-manager"

const suggestions = Array.from({ length: 10 }, (_, index) => ({
  name: `候補${index + 1}`,
  occurrences: 10 - index,
  lastSeenAt: "2026-08-12T00:00:00.000Z",
}))

function renderManager(deleteTag = vi.fn()) {
  render(
    <TagVocabularyManagerView
      createTag={vi.fn()}
      deleteTag={deleteTag}
      isLoading={false}
      name=""
      pending={false}
      promoteSuggestion={vi.fn()}
      setName={vi.fn()}
      suggestions={suggestions}
      tags={[{ id: "tag-1", name: "AI", createdAt: "2026-08-12" }]}
    />
  )
  return deleteTag
}

describe("TagVocabularyManagerView", () => {
  it("deletes a tag only from its remove button", async () => {
    const user = userEvent.setup()
    const deleteTag = renderManager()

    await user.click(screen.getByText("AI"))
    expect(deleteTag).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "タグ「AI」を削除" }))
    expect(deleteTag).toHaveBeenCalledWith("tag-1")
  })

  it("keeps suggestions dense and expands them on demand", async () => {
    const user = userEvent.setup()
    renderManager()

    expect(screen.queryByText("候補10")).toBeNull()
    await user.click(screen.getByRole("button", { name: "提案をすべて表示" }))
    expect(screen.getByText("候補10")).toBeTruthy()
  })
})
