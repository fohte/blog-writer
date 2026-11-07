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

export const InitialInputWaiting: Story = {
  name: 'the author has entered the first prompt before sending it.',
  args: {
    draft: 'Help me clarify who this article is for.',
    messages: [],
    proposals: [],
  },
}

export const AssistantSuggestsSeveralFields: Story = {
  name: 'the assistant proposes updates to several premise fields at once.',
  args: {
    messages: [
      {
        role: 'user',
        content: 'Make the premise more useful for new maintainers.',
      },
      {
        role: 'assistant',
        content: 'The article can help them choose which changes need review.',
      },
    ],
    proposals: [
      {
        field: 'audience',
        label: 'Reader',
        original: 'Readers learning the subject',
        replacement: 'New maintainers reviewing their first contribution',
      },
      {
        field: 'purpose',
        label: 'Purpose',
        original: 'Explain a useful idea',
        replacement: 'Help new maintainers decide which changes need review',
      },
      {
        field: 'claim',
        label: 'Claim',
        original: 'A clear process helps teams.',
        replacement:
          'A short review checklist helps new maintainers catch risky changes.',
      },
    ],
  },
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
    proposals: [
      {
        field: 'claim',
        label: 'Claim',
        original: 'A clear process helps teams.',
        replacement:
          'A short review checklist helps new maintainers catch risky changes.',
      },
    ],
  },
}
