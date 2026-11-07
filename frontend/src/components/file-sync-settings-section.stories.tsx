import type { Meta, StoryObj } from '@storybook/react-vite'

import { FileSyncSettingsSection } from '#components/file-sync-settings-section'

const meta = {
  component: FileSyncSettingsSection,
  args: {
    directory: '/workspace/articles',
  },
} satisfies Meta<typeof FileSyncSettingsSection>

export default meta
type Story = StoryObj<typeof meta>

export const Configured: Story = {
  name: 'the synchronization folder is shown',
}

export const RequestError: Story = {
  name: 'the synchronization settings request shows an error',
  args: {
    directory: undefined,
    error: '同期設定を読み込めませんでした。',
  },
}
