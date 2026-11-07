import type { Meta, StoryObj } from '@storybook/react-vite'

import { OfflineBanner } from '#components/offline-banner'

const meta = {
  component: OfflineBanner,
} satisfies Meta<typeof OfflineBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'the banner tells the writer that edits stay on this device while offline.',
}
