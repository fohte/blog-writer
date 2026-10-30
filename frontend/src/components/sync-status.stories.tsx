import type { Meta, StoryObj } from '@storybook/react-vite'

import { SyncStatus } from '#components/sync-status'

const meta = {
  component: SyncStatus,
} satisfies Meta<typeof SyncStatus>

export default meta
type Story = StoryObj<typeof meta>

export const Saved: Story = {
  name: 'The document is saved on this device.',
  args: { state: 'saved' },
}

export const Unsynced: Story = {
  name: 'The document is waiting to sync.',
  args: { state: 'unsynced' },
}

export const Syncing: Story = {
  name: 'The document is syncing with the server.',
  args: { state: 'syncing' },
}

export const Synced: Story = {
  name: 'The document is synced with the server.',
  args: { state: 'synced' },
}
