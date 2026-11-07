import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { ArticleExportPopover } from '#components/article-export-popover'

const doc = new Y.Doc()
setBody(doc, 'A short article body.')

type StoryArgs = Omit<ComponentProps<typeof ArticleExportPopover>, 'doc'>

function ArticleExportPopoverStory(args: StoryArgs) {
  return <ArticleExportPopover {...args} doc={doc} />
}

const meta = {
  component: ArticleExportPopoverStory,
  args: {
    articleId: 'sample-article',
    articleTitle: 'Sample article',
  },
} satisfies Meta<typeof ArticleExportPopoverStory>

export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  name: 'the export options are closed',
}

export const MarkdownSelected: Story = {
  name: 'the open options select Markdown',
  args: {
    defaultOpen: true,
    defaultFormat: 'markdown',
  },
}

export const MdxSelected: Story = {
  name: 'the open options select MDX',
  args: {
    defaultOpen: true,
    defaultFormat: 'mdx',
  },
}

export const ConversionError: Story = {
  name: 'the export options show a conversion error',
  args: {
    defaultOpen: true,
    defaultFormat: 'mdx',
    initialError: 'MDX 形式に変換できませんでした。',
  },
}
