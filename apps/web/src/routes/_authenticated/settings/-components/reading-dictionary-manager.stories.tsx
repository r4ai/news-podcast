import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import {
  ReadingDictionaryManagerView,
  type ReadingDictionaryEntry,
} from "./reading-dictionary-manager"

const entry = (
  surface: string,
  reading: string,
  source: ReadingDictionaryEntry["source"]
): ReadingDictionaryEntry => ({
  id: surface,
  surface,
  reading,
  accentType: 0,
  source,
  createdAt: "2026-08-12T00:00:00.000Z",
})

const entries = [
  entry("GPT-5", "ジーピーティーファイブ", "manual"),
  entry("Durable Objects", "デュラブルオブジェクツ", "ai_auto"),
  entry("SQLite", "エスキューライト", "manual"),
  entry("WAL", "ダブリューエーエル", "ai_auto"),
  entry("Kubernetes", "クーベルネティス", "ai_auto"),
]

const meta = {
  title: "Settings/Reading dictionary manager",
  component: ReadingDictionaryManagerView,
  args: {
    entries,
    isLoading: false,
    pending: false,
    addEntry: fn(),
    updateEntry: fn(),
    deleteEntry: fn(),
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof ReadingDictionaryManagerView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Loading: Story = {
  args: { entries: [], isLoading: true },
}

export const EmptyDictionary: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/読み辞書がまだありません/)).toBeVisible()
    await expect(canvas.queryByRole("searchbox")).toBeNull()
  },
}

/** 長い表記でも省略しない。折り返して行を伸ばす。 */
export const LongEntries: Story = {
  args: {
    entries: [
      entry(
        "Cloudflare Durable Objects",
        "クラウドフレア・デュラブルオブジェクツ",
        "ai_auto"
      ),
      entry(
        "OpenTelemetry Collector",
        "オープンテレメトリーコレクター",
        "manual"
      ),
      ...entries,
    ],
  },
}

export const Filtering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole("searchbox", { name: "登録済みの読みを絞り込む" }),
      "エスキュー"
    )
    await expect(canvas.getByText("SQLite")).toBeVisible()
    await expect(canvas.queryByText("GPT-5")).toBeNull()
  },
}

/** AIが入れたものだけを見直す。 */
export const AiAddedOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "AI自動" }))
    await expect(canvas.getByText("Durable Objects")).toBeVisible()
    await expect(canvas.queryByText("GPT-5")).toBeNull()
  },
}

export const Submitting: Story = {
  args: { pending: true },
}
