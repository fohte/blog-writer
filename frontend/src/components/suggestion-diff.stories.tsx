import type { Meta, StoryObj } from '@storybook/react-vite'

import { SuggestionDiff } from '#components/suggestion-diff'

const supportedSentence = 'The report records a steady increase.'
const unsupportedSentence = 'The program reached a national record.'
const unmarkedSentence = 'This may encourage more readers.'
const replacement = [
  supportedSentence,
  unsupportedSentence,
  unmarkedSentence,
].join(' ')

const meta = {
  component: SuggestionDiff,
} satisfies Meta<typeof SuggestionDiff>

export default meta
type Story = StoryObj<typeof meta>

export const Block: Story = {
  name: 'the diff strikes removed text in red and underlines added text in green.',
  args: {
    original: 'A short draft sentence.',
    replacement: 'A clearer sentence for the draft.',
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
    original: 'A sentence with a longer phrase that wraps on a narrow screen.',
    replacement:
      'A more specific sentence that still reads clearly on a narrow screen.',
  },
}

export const Inline: Story = {
  name: 'an inline diff stays within the sentence.',
  render: (args) => (
    <p>
      The draft keeps <SuggestionDiff {...args} /> around the change.
    </p>
  ),
  args: {
    inline: true,
    original: 'a short phrase',
    replacement: 'a clearer phrase',
  },
}

export const WritingFromSources: Story = {
  name: 'the draft distinguishes supported and unsupported facts.',
  args: {
    original: 'The previous draft needs a clearer explanation.',
    replacement,
    replacementMarks: [
      { from: 0, to: supportedSentence.length, verdict: 'supported' },
      {
        from: supportedSentence.length + 1,
        to: supportedSentence.length + 1 + unsupportedSentence.length,
        verdict: 'insufficient',
      },
    ],
  },
}
