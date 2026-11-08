import type { Meta, StoryObj } from '@storybook/react-vite'

import { EditorStatusBar } from '#components/editor-status-bar'

const meta = {
  component: EditorStatusBar,
} satisfies Meta<typeof EditorStatusBar>

export default meta
type Story = StoryObj<typeof meta>

const details = {
  llmRoute: 'server',
  characterCount: 3412,
} as const

export const Synced: Story = {
  name: 'the status bar shows the last sync time, the LLM route and the character count, followed by key hints.',
  args: {
    ...details,
    syncStatus: 'synced',
    syncedAt: new Date(2026, 0, 15, 2, 14).getTime(),
  },
}

export const Syncing: Story = {
  name: 'the status bar shows that changes saved on this device are being sent to the server.',
  args: { ...details, syncStatus: 'syncing' },
}

export const Unsynced: Story = {
  name: 'the status bar shows that changes saved on this device have not reached the server yet.',
  args: { ...details, syncStatus: 'unsynced' },
}

export const LocalLlm: Story = {
  name: 'the status bar shows that requests go to the LLM on this device.',
  args: {
    ...details,
    llmRoute: 'local',
    syncStatus: 'synced',
    syncedAt: new Date(2026, 0, 15, 23, 2).getTime(),
  },
}

export const ArticleLoading: Story = {
  name: 'the status bar shows only the save state while the LLM route and the article are unknown.',
  args: { syncStatus: 'unsynced' },
}
