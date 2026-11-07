import type { Meta, StoryObj } from '@storybook/react-vite'

import { TextDiffView } from '#components/text-diff-view'

const meta = {
  component: TextDiffView,
  args: {
    original: '# A small article\n\nThe original paragraph stays here.\n',
    modified: '# A small article\n\nThe edited paragraph stays here.\n',
  },
} satisfies Meta<typeof TextDiffView>

export default meta
type Story = StoryObj<typeof meta>

export const ChangedParagraph: Story = {
  name: 'the diff highlights a changed paragraph',
}
