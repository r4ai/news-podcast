import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"

import { InterestProfileFormView } from "./interest-profile-form"

const meta = {
  title: "Settings/Interest profile form",
  component: InterestProfileFormView,
  args: {
    draft: { include: "生成AI、フロントエンド", exclude: "芸能ゴシップ" },
    pending: false,
    confirmOpen: false,
    canSubmit: true,
    dirty: true,
    update: fn(),
    discard: fn(),
    requestSave: fn(),
    cancelSave: fn(),
    confirmSave: fn(),
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof InterestProfileFormView>

export default meta
type Story = StoryObj<typeof meta>

/** 保存済みの状態。変えていないので保存も破棄も押せない。 */
export const Pristine: Story = {
  args: { dirty: false, canSubmit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("button", { name: "保存" })).toBeDisabled()
    await expect(canvas.queryByText("未保存の変更")).toBeNull()
  },
}

export const Edited: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("未保存の変更")).toBeVisible()
  },
}

export const ConfirmDialogOpen: Story = {
  args: { confirmOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(canvas.getByText("保存しますか")).toBeVisible()
    await expect(canvas.getByText(/全記事を再処理/)).toBeVisible()
  },
}

export const Saving: Story = {
  args: { pending: true, canSubmit: false },
}

export const SubmitOpensConfirm: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "保存" }))
    await expect(args.requestSave).toHaveBeenCalled()
  },
}

/** 上限超過は、無効になったボタンではなく超えた欄の側で伝える。 */
export const OverLengthLimit: Story = {
  args: {
    draft: { include: "あ".repeat(2_050), exclude: "" },
    canSubmit: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("50字を減らしてください。")).toBeVisible()
  },
}
