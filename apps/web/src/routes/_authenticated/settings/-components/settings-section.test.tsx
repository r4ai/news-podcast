import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AiEnrichPanelView } from "./ai-enrich-panel"
import { InterestProfileFormView } from "./interest-profile-form"
import { ReadingDictionaryManagerView } from "./reading-dictionary-manager"
import { TagVocabularyManagerView } from "./tag-vocabulary-manager"

/**
 * Cardは`flex flex-col gap-(--card-spacing)`で見出しと本文を離している。
 * `<Card>`の内側へ`<form>`を1枚挟むと、そのgapは子1つにしか掛からなくなり、
 * 見出しの説明文と最初の入力欄が隙間なく続いてしまう (実測0px)。
 *
 * 見た目は視覚回帰が見るが、原因になる構造はここで止める。
 */
function cards(container: HTMLElement): HTMLElement[] {
  const found = container.querySelectorAll<HTMLElement>("[data-slot=card]")
  if (found.length === 0) throw new Error("カードが見つからない")
  return Array.from(found)
}

function childSlots(card: HTMLElement): string[] {
  return Array.from(
    card.children,
    (child) => child.getAttribute("data-slot") ?? child.tagName.toLowerCase()
  )
}

const views = [
  {
    name: "興味プロフィール",
    render: () => (
      <InterestProfileFormView
        canSubmit
        cancelSave={vi.fn()}
        confirmOpen={false}
        confirmSave={vi.fn()}
        dirty
        discard={vi.fn()}
        draft={{ include: "AI", exclude: "野球" }}
        pending={false}
        requestSave={vi.fn()}
        update={vi.fn()}
      />
    ),
  },
  {
    name: "AI処理",
    render: () => (
      <AiEnrichPanelView
        cancelReprocess={vi.fn()}
        confirmOpen={false}
        confirmReprocess={vi.fn()}
        daily={{ used: 12, limit: 200 }}
        pending={false}
        reprocessableCount={5}
        requestReprocess={vi.fn()}
      />
    ),
  },
  {
    name: "タグ語彙",
    render: () => (
      <TagVocabularyManagerView
        createTag={vi.fn()}
        deleteTag={vi.fn()}
        isLoading={false}
        pending={false}
        promoteSuggestion={vi.fn()}
        suggestions={[]}
        tags={[]}
      />
    ),
  },
  {
    name: "読み辞書",
    render: () => (
      <ReadingDictionaryManagerView
        addEntry={vi.fn()}
        deleteEntry={vi.fn()}
        entries={[]}
        isLoading={false}
        pending={false}
        updateEntry={vi.fn()}
      />
    ),
  },
] as const

describe("設定カードの構造", () => {
  for (const view of views) {
    it(`${view.name}: どのカードも見出しと本文を直接の子に持つ`, () => {
      const { container } = render(view.render())

      for (const card of cards(container)) {
        const slots = childSlots(card)
        expect(slots).toContain("card-header")
        expect(slots).toContain("card-content")
      }
    })

    it(`${view.name}: 見出しはh2で、説明との境目を持つ`, () => {
      const { container } = render(view.render())
      const [first, ...rest] = cards(container)

      expect(first?.querySelector("h2")?.textContent).toBe(view.name)
      for (const card of [first, ...rest]) {
        const header = card?.querySelector("[data-slot=card-header]")
        // 区切り線はCardHeaderの`[.border-b]:pb-(--card-spacing)`も同時に効かせる。
        expect(header?.className).toContain("border-b")
        expect(header?.querySelector("h2")).not.toBeNull()
      }
    })
  }

  /** ページh1の下は全てh2。区画の中で段を作らない。 */
  it("設定の見出しはh2だけで構成される", () => {
    render(
      <TagVocabularyManagerView
        createTag={vi.fn()}
        deleteTag={vi.fn()}
        isLoading={false}
        pending={false}
        promoteSuggestion={vi.fn()}
        suggestions={[
          { name: "Rust", occurrences: 3, lastSeenAt: "2026-08-12" },
        ]}
        tags={[]}
      />
    )

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    ).toEqual(["タグ語彙", "AIからの提案"])
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull()
  })
})
