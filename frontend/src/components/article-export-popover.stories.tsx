import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleExportPopover } from '#components/article-export-popover'

const meta = {
  component: ArticleExportPopover,
  args: {
    articleId: 'sample-article',
    body: 'A short article body.',
  },
} satisfies Meta<typeof ArticleExportPopover>

export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  name: 'the export options are closed',
}

export const MarkdownSelected: Story = {
  name: 'the open options select Markdown',
  args: {
    open: true,
    format: 'markdown',
  },
}

export const MdxSelected: Story = {
  name: 'the open options select MDX',
  args: {
    open: true,
    format: 'mdx',
  },
}
