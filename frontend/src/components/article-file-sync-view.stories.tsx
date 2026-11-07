import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleFileSyncView } from '#components/article-file-sync-view'

const meta = {
  component: ArticleFileSyncView,
  args: {
    body: '# A small article\n\nThe article body.\n',
    onImport: () => {},
    onOpenChange: () => {},
    onOverwrite: () => {},
    onPathChange: () => {},
    onSetPath: () => {},
  },
} satisfies Meta<typeof ArticleFileSyncView>

export default meta
type Story = StoryObj<typeof meta>

export const Unset: Story = {
  name: 'the article has no synchronization file',
  args: {
    open: true,
    path: '',
    status: 'unset',
  },
}

export const Synced: Story = {
  name: 'the article is synchronized with its file',
  args: {
    open: true,
    path: 'notes/example.md',
    status: 'synced',
  },
}

export const ExternalChanges: Story = {
  name: 'the file contains changes that can be imported or overwritten',
  args: {
    content: '# A small article\n\nAn edited paragraph.\n',
    contentHash: 'sample-hash',
    open: true,
    path: 'notes/example.md',
    status: 'external_changed',
  },
}

export const MissingFile: Story = {
  name: 'the selected file is missing and can be recreated',
  args: {
    content: null,
    open: true,
    path: 'notes/example.md',
    status: 'external_changed',
  },
}

export const RequestError: Story = {
  name: 'the synchronization request shows an error',
  args: {
    error: 'Synchronization file changed; reload it before continuing',
    open: true,
    path: 'notes/example.md',
    status: 'external_changed',
  },
}

export const Busy: Story = {
  name: 'the synchronization request is in progress',
  args: {
    busy: true,
    content: '# A small article\n\nAn edited paragraph.\n',
    contentHash: 'sample-hash',
    open: true,
    path: 'notes/example.md',
    status: 'external_changed',
  },
}
