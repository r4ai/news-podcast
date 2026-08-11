import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, within } from "storybook/test"

import { TagVocabularyManagerView } from "./tag-vocabulary-manager"

const meta = {
  title: "Settings/Tag vocabulary manager",
  component: TagVocabularyManagerView,
  args: {
    tags: [
      { id: "tag-1", name: "AI", createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "tag-2", name: "Web", createdAt: "2026-08-01T00:00:00.000Z" },
    ],
    suggestions: [],
    isLoading: false,
    name: "",
    pending: false,
    setName: fn(),
    createTag: fn(),
    deleteTag: fn(),
    promoteSuggestion: fn(),
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-xl p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof TagVocabularyManagerView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const EmptyVocabulary: Story = {
  args: { tags: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        "タグがまだありません。上のフォームから追加してください。"
      )
    ).toBeVisible()
  },
}

export const WithAiSuggestions: Story = {
  args: {
    suggestions: [
      {
        name: "量子コンピュータ",
        occurrences: 5,
        lastSeenAt: "2026-08-10T00:00:00.000Z",
      },
      {
        name: "半導体",
        occurrences: 2,
        lastSeenAt: "2026-08-09T00:00:00.000Z",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("量子コンピュータ")).toBeVisible()
    await expect(
      canvas.getAllByRole("button", { name: "このタグを作る" })
    ).toHaveLength(2)
  },
}
