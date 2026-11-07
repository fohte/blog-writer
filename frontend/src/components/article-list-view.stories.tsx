import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleListView } from '#components/article-list-view'

const meta = {
  component: ArticleListView,
  args: {
    articles: [],
    statuses: {},
    offline: false,
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
  name: 'the list shows each title with its creation date and only the states that need attention.',
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
      {
        id: 'article-c',
        title: 'Notes on a weekend project',
        createdAt: Date.UTC(2025, 11, 3, 8),
        syncFilePath: 'posts/weekend-project.md',
        syncFileStatus: 'external_changed',
      },
      {
        id: 'article-d',
        title: 'A draft that is syncing',
        createdAt: Date.UTC(2025, 10, 20, 8),
      },
    ],
    statuses: {
      'article-a': 'synced',
      'article-b': 'unsynced',
      'article-d': 'syncing',
    },
  },
}

export const LongTitle: Story = {
  name: 'the list wraps a long unbroken title inside its row.',
  args: {
    articles: [
      {
        id: 'article-a',
        title: 'Unbroken'.repeat(16),
        createdAt: Date.UTC(2026, 0, 15, 9),
      },
    ],
    statuses: { 'article-a': 'unsynced' },
  },
}

export const Offline: Story = {
  name: 'the list shows the offline status and a banner explaining that edits stay on this device.',
  args: {
    offline: true,
    articles: [
      {
        id: 'article-a',
        title: 'A useful article',
        createdAt: Date.UTC(2026, 0, 15, 9),
      },
    ],
  },
}

export const AuthenticationRequired: Story = {
  name: 'the list asks the writer to log in again when authentication expires.',
  args: { requiresAuthentication: true, canCreate: false },
}

export const WithError: Story = {
  name: 'the list shows an error when articles cannot be synchronized.',
  args: { error: 'Articles could not be synchronized.' },
}
