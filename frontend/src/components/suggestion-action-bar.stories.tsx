import type { Meta, StoryObj } from '@storybook/react-vite'

import { SuggestionActionBar } from '#components/suggestion-action-bar'

const meta = {
  component: SuggestionActionBar,
  args: {
    onAccept: () => undefined,
    onReject: () => undefined,
  },
} satisfies Meta<typeof SuggestionActionBar>

export default meta
type Story = StoryObj<typeof meta>

export const Request: Story = {
  name: 'the band shows the request, what it replaces, and the reject and accept keys.',
  args: {
    label: 'Make it concise',
    target: '段落を置き換え',
  },
}

export const WithNote: Story = {
  name: 'the band shows the note that comes with a suggestion that has no request.',
  args: {
    target: '選択範囲を置き換え',
    note: '根拠の資料: Sample source',
  },
}

export const WithMarkup: Story = {
  name: 'the band says that HTML and links in the suggestion stay as text until it is accepted.',
  args: {
    label: 'Add one example',
    target: '挿入',
    showsMarkupAsText: true,
  },
}

export const Narrow: Story = {
  name: 'the band wraps its actions onto a second row in a narrow column.',
  render: (args) => (
    <div style={{ width: '20rem' }}>
      <SuggestionActionBar {...args} />
    </div>
  ),
  args: {
    label: 'Fix the flow with the paragraphs around it',
    target: '段落を置き換え',
  },
}

export const Seam: Story = {
  name: 'a transition suggestion offers to accept the sentences on both sides of the seam.',
  args: {
    variant: 'seam',
  },
}

const phoneScreen: NonNullable<Story['decorators']> = [
  (Story) => (
    <div className="relative h-96 w-97.5 transform-gpu">
      <Story />
    </div>
  ),
]

export const Sheet: Story = {
  name: 'on a phone, the bottom sheet shows the request and what it replaces above large reject and accept buttons.',
  args: {
    presentation: 'sheet',
    label: 'Add one example',
    target: '段落を置き換え',
  },
  decorators: phoneScreen,
}

export const SeamSheet: Story = {
  name: 'on a phone, the bottom sheet for a transition accepts the sentences on both sides of the seam.',
  args: {
    presentation: 'sheet',
    variant: 'seam',
  },
  decorators: phoneScreen,
}
