import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleFileSyncBannerView } from '#components/article-file-sync-banner-view'

const meta = {
  component: ArticleFileSyncBannerView,
  args: {
    state: 'external_changed',
    path: 'notes/example.md',
    canImport: true,
    onShowDiff: () => {},
    onImport: () => {},
    onOverwrite: () => {},
    onChangePath: () => {},
    onUndo: () => {},
  },
} satisfies Meta<typeof ArticleFileSyncBannerView>

export default meta
type Story = StoryObj<typeof meta>

export const ExternalChanges: Story = {
  name: 'the banner offers to compare, import, or overwrite a file changed outside the app',
}

export const LoadingFile: Story = {
  name: 'the import action waits until the changed file has been read',
  args: {
    busy: true,
    canImport: false,
  },
}

export const MissingFile: Story = {
  name: 'the banner offers to recreate a missing file or choose another path',
  args: {
    state: 'missing',
  },
}

export const Imported: Story = {
  name: 'after an import the banner offers to undo it',
  args: {
    state: 'imported',
  },
}

export const RequestError: Story = {
  name: 'the banner shows why the file could not be overwritten',
  args: {
    error: '同期ファイルを上書きできませんでした: HTTP 500',
  },
}
