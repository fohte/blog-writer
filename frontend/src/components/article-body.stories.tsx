import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleBody } from '#components/article-body'

const meta = {
  title: 'Editor/ArticleBody',
  component: ArticleBody,
  args: {
    title: 'A useful article',
    loading: false,
    empty: false,
    children: <p>Write the article here.</p>,
    onTitleChange: () => {},
    onWriteMemo: () => {},
    onDecidePremise: () => {},
  },
} satisfies Meta<typeof ArticleBody>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'the body shows the title field above the editor.',
}

export const Loading: Story = {
  name: 'the body shows gray placeholder lines while the article opens.',
  args: { loading: true, children: undefined },
}

export const Empty: Story = {
  name: 'the empty body invites the writer to start with a memo or the premise.',
  args: { empty: true, title: '' },
}
