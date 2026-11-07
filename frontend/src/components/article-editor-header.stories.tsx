import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleEditorHeader } from '#components/article-editor-header'

const meta = {
  title: 'Editor/ArticleEditorHeader',
  component: ArticleEditorHeader,
  args: {
    mobile: false,
    title: 'A useful article',
    syncStatus: 'synced',
    onBack: () => {},
    onOpenSettings: () => {},
    onShowPremise: () => {},
  },
} satisfies Meta<typeof ArticleEditorHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {
  name: 'the desktop header shows the article path, sync status, export, and settings.',
  args: { onExport: () => {} },
}

export const MobileArticle: Story = {
  name: 'the mobile header shows the title with a back button and a more menu.',
  args: { mobile: true },
  decorators: [
    (Story) => (
      <div className="w-97.5">
        <Story />
      </div>
    ),
  ],
}

export const MobilePanel: Story = {
  name: 'the mobile header shows the covering panel title and a way back.',
  args: {
    mobile: true,
    mobilePanel: { title: '構成', closeLabel: '本文へ', onClose: () => {} },
  },
  decorators: [
    (Story) => (
      <div className="w-97.5">
        <Story />
      </div>
    ),
  ],
}
