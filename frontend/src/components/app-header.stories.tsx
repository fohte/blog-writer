import { Button } from '@fohte/ui/button'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { AppHeader } from '#components/app-header'
import { SyncStatus } from '#components/sync-status'

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

export const InArticle: Story = {
  name: 'the header shows the article title, its sync status, and article actions inside the editor.',
  args: {
    articleTitle: 'Notes on a weekend project',
    onHome: () => {},
    status: <SyncStatus state="synced" />,
    actions: (
      <Button type="button" variant="outline">
        書き出し
      </Button>
    ),
  },
}
