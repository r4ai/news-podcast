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
    update: fn(),
    requestSave: fn(),
    cancelSave: fn(),
    confirmSave: fn(),
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-xl p-4 sm:p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof InterestProfileFormView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

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
