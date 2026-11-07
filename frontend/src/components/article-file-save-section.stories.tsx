import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { ArticleFileSaveSection } from '#components/article-file-save-section'

const doc = new Y.Doc()
setBody(doc, 'A short article body.')

type StoryArgs = Omit<ComponentProps<typeof ArticleFileSaveSection>, 'doc'>

function ArticleFileSaveSectionStory(args: StoryArgs) {
  return <ArticleFileSaveSection {...args} doc={doc} />
}

const meta = {
  component: ArticleFileSaveSectionStory,
  args: {
    articleId: 'sample-article',
    articleTitle: 'Sample article',
  },
} satisfies Meta<typeof ArticleFileSaveSectionStory>

export default meta
type Story = StoryObj<typeof meta>

export const MarkdownSelected: Story = {
  name: 'the section saves the body as Markdown by default',
}

export const MdxSelected: Story = {
  name: 'the section saves the body as MDX once MDX is selected',
  args: {
    defaultFormat: 'mdx',
  },
}

export const ConversionError: Story = {
  name: 'the section shows why the body could not be converted to MDX',
  args: {
    defaultFormat: 'mdx',
    initialError: 'MDX 形式に変換できませんでした。',
  },
}
