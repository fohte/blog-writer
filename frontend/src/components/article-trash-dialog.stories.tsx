import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleTrashDialog } from '#components/article-trash-dialog'

const meta = {
  component: ArticleTrashDialog,
  args: {
    articles: [],
    open: true,
    onOpenChange: () => {},
    onRestore: () => {},
  },
} satisfies Meta<typeof ArticleTrashDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  name: 'the trash says it is empty after the last article is restored.',
}

export const WithArticles: Story = {
  name: 'the trash lists each article with the date it disappears and a restore button.',
  args: {
    articles: [
      {
        id: 'article-a',
        title: 'A discarded draft',
        createdAt: Date.UTC(2026, 0, 15, 9),
        trashedAt: Date.UTC(2026, 1, 1, 9),
      },
      {
        id: 'article-b',
        title: 'Unbroken'.repeat(16),
        createdAt: Date.UTC(2026, 0, 16, 9),
        trashedAt: Date.UTC(2026, 1, 2, 9),
      },
    ],
  },
}
