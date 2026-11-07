import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticlePublishView } from '#components/article-publish-view'

const destinations = [
  {
    id: 'sample-site',
    format: 'markdown',
    frontmatter_template: 'title: {{ title }}\ndate: {{ date }}',
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

export const FeatureDisabled: Story = {
  name: 'the PR section is hidden when publishing is disabled',
  args: { enabled: false },
}

export const Incomplete: Story = {
  name: 'the article has no publishing details yet',
  args: { selectedDestinationId: undefined, slug: '', frontmatter: '' },
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

export const Requesting: Story = {
  name: 'the publish request is in progress',
  args: { busy: true },
}

export const Published: Story = {
  name: 'the published pull request link is available',
  args: {
    canPublish: false,
    diff: { original: '', modified: 'title: "Sample article"\n\nNew body' },
    publishedUrl: 'https://github.com/example/site/pull/12',
  },
}

export const Error: Story = {
  name: 'the publish request shows an error',
  args: {
    error: '公開先のファイルが変更されています。差分を取り直してください。',
  },
}
