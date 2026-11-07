import type { Meta, StoryObj } from '@storybook/react-vite'

import { MobilePanelHeader } from '#components/mobile-panel-header'

const meta = {
  title: 'Editor/MobilePanelHeader',
  component: MobilePanelHeader,
  decorators: [
    (Story) => (
      <div className="w-97.5">
        <Story />
      </div>
    ),
  ],
  args: { title: 'メモ', closeLabel: '閉じる', onClose: () => {} },
} satisfies Meta<typeof MobilePanelHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Memo: Story = {
  name: 'the memo screen header shows its title and a close button.',
}

export const Outline: Story = {
  name: 'the outline screen header offers a way back to the body.',
  args: { title: '構成', closeLabel: '本文へ' },
}
