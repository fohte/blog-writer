import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleListView } from '#components/article-list-view'
import type { Article, ArticleSummary } from '#lib/sync-client'

const emptyBody: (id: string) => string = () => ''
const noSummary: (id: string) => ArticleSummary | undefined = () => undefined

const meta = {
  component: ArticleListView,
  args: {
    articles: [],
    statuses: {},
    searchQuery: '',
    sortOrder: 'edited',
    offline: false,
    requiresAuthentication: false,
    canCreate: true,
    readArticleBody: emptyBody,
    readArticleSummary: noSummary,
    onSearchQueryChange: () => {},
    onSortOrderChange: () => {},
    onCreateArticle: () => {},
    onOpenArticle: () => {},
    onDuplicateArticle: () => {},
    onTrashArticle: () => {},
    onRestoreArticle: () => {},
    onOpenSettings: () => {},
    onLoginAgain: () => {},
  },
} satisfies Meta<typeof ArticleListView>

export default meta
type Story = StoryObj<typeof meta>

const articles: Article[] = [
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
    updatedAt: Date.UTC(2026, 0, 20, 8),
    syncFilePath: 'posts/weekend-project.md',
    syncFileStatus: 'external_changed',
  },
  {
    id: 'article-d',
    title: 'A draft that is syncing',
    createdAt: Date.UTC(2025, 10, 20, 8),
  },
]

const trashedArticle: Article = {
  id: 'article-e',
  title: 'A discarded draft',
  createdAt: Date.UTC(2025, 9, 1, 8),
  trashedAt: Date.UTC(2026, 0, 21, 8),
}

const statuses = {
  'article-a': 'synced',
  'article-b': 'unsynced',
  'article-d': 'syncing',
} as const

export const Empty: Story = {
  name: 'the list shows its empty state before any articles are created.',
}

export const WithArticles: Story = {
  name: 'the list shows each title with its creation date and only the states that need attention, most recently edited first.',
  args: { articles, statuses },
}

export const SortedByCreation: Story = {
  name: 'the list starts from the oldest article when sorted by creation.',
  args: { articles, statuses, sortOrder: 'created' },
}

export const SearchResults: Story = {
  name: 'the list narrows to the article whose body contains the search text.',
  args: {
    articles,
    statuses,
    searchQuery: 'compost',
    readArticleBody: (id) =>
      id === 'article-c' ? 'Turning the compost on a weekend.' : '',
  },
}

export const NoSearchResults: Story = {
  name: 'the list says that no article matches the search text.',
  args: { articles, statuses, searchQuery: 'absent' },
}

const summaries: Record<string, ArticleSummary> = {
  'article-a': { unorganizedMemoCount: 7, bodyIsEmpty: false },
  'article-b': { unorganizedMemoCount: 3, bodyIsEmpty: true },
  'article-c': { unorganizedMemoCount: 0, bodyIsEmpty: true },
  'article-d': { unorganizedMemoCount: 0, bodyIsEmpty: false },
}

export const WithSummaries: Story = {
  name: 'the list shows the unorganized memo count and a missing body only on the rows they apply to.',
  args: { articles, readArticleSummary: (id) => summaries[id] },
}

export const SyncProgress: Story = {
  name: 'the list counts the synchronized articles while the rest are still in progress.',
  args: {
    articles,
    statuses: {
      'article-a': 'synced',
      'article-b': 'syncing',
      'article-c': 'syncing',
      'article-d': 'syncing',
    },
  },
}

export const WithTrash: Story = {
  name: 'the list leaves out trashed articles and links to the trash beside the count.',
  args: { articles: [...articles, trashedArticle], statuses },
}

export const OnlyTrash: Story = {
  name: 'the list keeps a link to the trash when every article is trashed.',
  args: { articles: [trashedArticle] },
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
