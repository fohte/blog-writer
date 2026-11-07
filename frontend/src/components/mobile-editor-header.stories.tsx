import type { Meta, StoryObj } from '@storybook/react-vite'

import { MobileEditorHeader } from '#components/mobile-editor-header'
import { SyncStatus } from '#components/sync-status'

const meta = {
  title: 'Editor/MobileEditorHeader',
  component: MobileEditorHeader,
  decorators: [
    (Story) => (
      <div className="w-97.5">
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'A practical guide to writing focused articles on a phone',
    status: <SyncStatus state="synced" />,
    menuItems: [
      { label: '前提', onSelect: () => {} },
      { label: '資料', onSelect: () => {} },
      { label: '書き出し', onSelect: () => {} },
      { label: '設定', onSelect: () => {} },
    ],
    onBack: () => {},
  },
} satisfies Meta<typeof MobileEditorHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'the header truncates a long title next to the sync status.',
}

export const MenuOpen: Story = {
  name: 'the more menu lists the premise, sources, export, and settings.',
  args: { defaultMenuOpen: true },
}
