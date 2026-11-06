import type { Meta, StoryObj } from '@storybook/react-vite'

import { SuggestionDiff } from '#components/suggestion-diff'

const meta = {
  component: SuggestionDiff,
} satisfies Meta<typeof SuggestionDiff>

export default meta
type Story = StoryObj<typeof meta>

export const Focused: Story = {
  name: 'the focused suggestion shows accept and reject actions.',
  args: {
    focused: true,
    onAccept: () => {},
    onReject: () => {},
    original: 'A short draft sentence.',
    replacement: 'A clearer sentence for the draft.',
  },
}

export const Unfocused: Story = {
  name: 'the suggestion shows its changes without actions.',
  args: {
    original: 'A short draft sentence.',
    replacement: 'A clearer sentence for the draft.',
  },
}

export const Generating: Story = {
  name: 'the editor shows a compact creating state while a suggestion is pending.',
  args: {
    generating: true,
    original: '',
    replacement: '',
  },
}

export const Narrow: Story = {
  name: 'the diff wraps within a narrow column.',
  render: (args) => (
    <div style={{ width: '20rem' }}>
      <SuggestionDiff {...args} />
    </div>
  ),
  args: {
    focused: true,
    onAccept: () => {},
    onReject: () => {},
    original: 'A sentence with a longer phrase that wraps on a narrow screen.',
    replacement:
      'A more specific sentence that still reads clearly on a narrow screen.',
  },
}

export const Inline: Story = {
  name: 'an inline diff stays within the sentence.',
  args: {
    focused: true,
    inline: true,
    onAccept: () => {},
    onReject: () => {},
    original: 'a short phrase',
    replacement: 'a clearer phrase',
  },
}
