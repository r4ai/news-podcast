import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import { TagVocabularyManagerView } from "./tag-vocabulary-manager"

const vocabulary = [
  "生成AI",
  "フロントエンド",
  "TypeScript",
  "データベース",
  "セキュリティ",
  "インフラ",
  "設計",
  "パフォーマンス",
  "アクセシビリティ",
  "モバイル",
  "オープンソース",
  "開発者体験",
].map((name, index) => ({
  id: `tag-${index}`,
  name,
  createdAt: "2026-08-01T00:00:00.000Z",
}))

const meta = {
  title: "Settings/Tag vocabulary manager",
  component: TagVocabularyManagerView,
  args: {
    tags: vocabulary.slice(0, 2),
    suggestions: [],
    isLoading: false,
    pending: false,
    createTag: fn(),
    deleteTag: fn(),
    promoteSuggestion: fn(),
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
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
    await expect(canvas.getByText(/語彙がまだありません/)).toBeVisible()
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
      canvas.getAllByRole("button", { name: /を語彙に追加$/ })
    ).toHaveLength(2)
  },
}

/** 語彙が育つと絞り込み欄が出る。提案は畳まずに全部並べる。 */
export const LargeVocabulary: Story = {
  args: {
    tags: vocabulary,
    suggestions: Array.from({ length: 24 }, (_, index) => ({
      name: `候補となる長めのタグ名${index + 1}`,
      occurrences: 24 - index,
      lastSeenAt: "2026-08-10T00:00:00.000Z",
    })),
  },
}

/** 削除は記事側の付与ごと消える。押しただけでは消えない。 */
export const ConfirmsDeletion: Story = {
  args: { tags: vocabulary },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole("button", { name: "タグ「生成AI」を削除" })
    )
    const dialog = within(canvasElement.ownerDocument.body)
    await expect(dialog.getByText(/記事からも外れ/)).toBeVisible()
    await expect(args.deleteTag).not.toHaveBeenCalled()
  },
}

export const Loading: Story = {
  args: { isLoading: true, suggestions: [], tags: [] },
}
