import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticlePublishView } from '#components/article-publish-view'

const destinations = [
  {
    id: 'sample-site',
    format: 'markdown',
    frontmatter_template: 'title: {{ title }}\ndate: {{ date }}',
  },
] as const
const multipleDestinations = [
  ...destinations,
  {
    id: 'another-site',
    format: 'markdown',
    frontmatter_template: 'title: {{ title }}',
  },
] as const

const meta = {
  component: ArticlePublishView,
  args: {
    destinations: [...destinations],
    selectedDestinationId: 'sample-site',
    slug: 'sample-post',
    frontmatter: 'title: "Sample article"\ndate: "2026-01-15"',
    onDestinationChange: () => {},
    onSlugChange: () => {},
    onFrontmatterChange: () => {},
    onShowDiff: () => {},
    onPublish: () => {},
  },
} satisfies Meta<typeof ArticlePublishView>

export default meta
type Story = StoryObj<typeof meta>

export const Incomplete: Story = {
  name: 'the article has no publishing details yet',
  args: {
    destinations: [...multipleDestinations],
    selectedDestinationId: undefined,
    slug: '',
    frontmatter: '',
  },
}

export const MissingDestination: Story = {
  name: 'the saved publishing destination is no longer available',
  args: {
    destinationUnavailable: true,
    selectedDestinationId: undefined,
  },
}

export const DiffReady: Story = {
  name: 'the existing file is ready to publish after review',
  args: {
    canPublish: true,
    diff: {
      original: 'title: "Sample article"\n\nOld body',
      modified: 'title: "Sample article"\n\nUpdated body',
    },
  },
}

export const NewFile: Story = {
  name: 'the new file has no original content',
  args: {
    canPublish: true,
    diff: { original: '', modified: 'title: "Sample article"\n\nNew body' },
  },
}

export const RequestingDiff: Story = {
  name: 'the destination comparison is in progress',
  args: { busyAction: 'diff' },
}

export const Publishing: Story = {
  name: 'the pull request is being created',
  args: { busyAction: 'publish' },
}

export const Published: Story = {
  name: 'the published pull request link is available',
  args: {
    canPublish: false,
    publishedUrl: 'https://github.com/example/site/pull/12',
  },
}

export const Error: Story = {
  name: 'the publish request shows an error',
  args: {
    error: 'PR を作成できませんでした: HTTP 500',
  },
}

export const Conflict: Story = {
  name: 'the updated destination file is ready for review again',
  args: {
    diff: {
      original: 'title: "Sample article"\n\nNew destination body',
      modified: 'title: "Sample article"\n\nUpdated body',
    },
    error:
      '公開先のファイルが変更されています。 The file changed. 最新の差分を取り直しました。',
  },
}
