import type { Meta, StoryObj } from '@storybook/react-vite'

import { EditorStatusBar } from '#components/editor-status-bar'

const meta = {
  component: EditorStatusBar,
} satisfies Meta<typeof EditorStatusBar>

export default meta
type Story = StoryObj<typeof meta>

export const Synced: Story = {
  name: 'the status bar shows the article is saved on this device and synced, followed by key hints.',
  args: { syncStatus: 'synced' },
}

export const Unsynced: Story = {
  name: 'the status bar shows that changes saved on this device have not reached the server yet.',
  args: { syncStatus: 'unsynced' },
}
