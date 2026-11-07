import type { Meta, StoryObj } from '@storybook/react-vite'

import { PremiseProposalView } from '#components/premise-proposal-view'

const meta = {
  title: 'Editor/PremiseProposalView',
  component: PremiseProposalView,
  args: {
    draft: '',
    messages: [
      {
        role: 'user',
        content: 'Make the claim more specific for first-time maintainers.',
      },
      {
        role: 'assistant',
        content:
          'Which maintenance decision should the article help them make?',
      },
    ],
    proposals: [
      {
        field: 'claim',
        label: 'Claim',
        original: 'A clear process helps teams.',
        replacement:
          'A short review checklist helps new maintainers catch risky changes.',
      },
    ],
    onDraftChange: () => {},
    onSubmit: () => {},
    onAccept: () => {},
    onReject: () => {},
  },
} satisfies Meta<typeof PremiseProposalView>

export default meta
type Story = StoryObj<typeof meta>

export const AssistantAsksAndSuggestsAClaim: Story = {
  name: 'the assistant asks a question and proposes a claim.',
}

export const AssistantIsThinking: Story = {
  name: 'the assistant is preparing a response.',
  args: {
    generating: true,
    messages: [],
    proposals: [],
  },
}

export const RequestFailed: Story = {
  name: 'the conversation shows a failed request.',
  args: {
    error: 'The proposal request failed. Please try again.',
    messages: [],
    proposals: [],
  },
}
