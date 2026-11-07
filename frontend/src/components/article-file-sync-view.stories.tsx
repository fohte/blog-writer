import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleFileSyncView } from '#components/article-file-sync-view'

const articleBody = `# 記事の本文

記事本文には変更箇所とその周辺の文章が表示されます。取り込むか上書きするかを判断できるように、両方の内容を同じ幅で読み比べられます。`
const fileContent = `# 記事の本文

同期ファイルで段落が変更されました。差分を読み、周辺の文章を含めて変更内容を確認してから、本文に取り込むかファイルを上書きできます。`

const meta = {
  component: ArticleFileSyncView,
  args: {
    body: '# A small article\n\nThe article body.\n',
    onImport: () => {},
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
    path: '',
    status: 'unset',
  },
}

export const Synced: Story = {
  name: 'the article is synchronized with its file',
  args: {
    path: 'notes/example.md',
    status: 'synced',
  },
}

export const ExternalChanges: Story = {
  name: 'the file contains changes that can be imported or overwritten',
  args: {
    body: articleBody,
    content: fileContent,
    contentHash: 'sample-hash',
    path: 'notes/example.md',
    status: 'external_changed',
  },
}

export const MissingFile: Story = {
  name: 'the selected file is missing and can be recreated',
  args: {
    content: null,
    path: 'notes/example.md',
    status: 'external_changed',
  },
}

export const RequestError: Story = {
  name: 'the synchronization request shows an error',
  args: {
    error: 'Synchronization file changed; reload it before continuing',
    path: 'notes/example.md',
    status: 'external_changed',
  },
}

export const Busy: Story = {
  name: 'the synchronization request is in progress',
  args: {
    busy: true,
    body: articleBody,
    content: fileContent,
    contentHash: 'sample-hash',
    path: 'notes/example.md',
    status: 'external_changed',
  },
}
