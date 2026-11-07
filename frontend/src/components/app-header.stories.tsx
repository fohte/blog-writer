import type { Meta, StoryObj } from '@storybook/react-vite'

import { AppHeader } from '#components/app-header'

const meta = {
  component: AppHeader,
  args: { onOpenSettings: () => {} },
} satisfies Meta<typeof AppHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'the header shows the logo and the settings button.',
}

export const WithStatus: Story = {
  name: 'the header shows a connection status next to the settings button.',
  args: {
    status: (
      <span className="font-mono text-xs text-muted-foreground-strong">
        ○ オフライン
      </span>
    ),
  },
}
