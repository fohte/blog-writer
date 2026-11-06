import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleListView } from '#components/article-list-view'

const meta = {
  component: ArticleListView,
  args: {
    articles: [],
    statuses: {},
    requiresAuthentication: false,
    canCreate: true,
    onCreateArticle: () => {},
    onOpenArticle: () => {},
    onOpenSettings: () => {},
    onLoginAgain: () => {},
  },
} satisfies Meta<typeof ArticleListView>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  name: 'the list shows its empty state before any articles are created.',
}

export const WithArticles: Story = {
  name: 'the list shows article titles, creation times, and sync status.',
  args: {
    articles: [
      {
        id: 'article-a',
        title: 'A useful article',
        createdAt: Date.UTC(2026, 0, 15, 9),
      },
      {
        id: 'article-b',
        title: 'An unfinished draft',
        createdAt: Date.UTC(2026, 0, 16, 11),
      },
    ],
    statuses: { 'article-a': 'synced', 'article-b': 'unsynced' },
  },
}
