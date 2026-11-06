import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineProposalRow } from '#components/outline-proposal-row'

const meta = {
  component: OutlineProposalRow,
  args: {
    depth: 0,
    proposal: {
      id: 'proposal-a',
      from: 0,
      to: 0,
      replacement: '## Summary',
    },
    onProposalAccept: () => {},
    onProposalReject: () => {},
  },
} satisfies Meta<typeof OutlineProposalRow>

export default meta
type Story = StoryObj<typeof meta>

export const ProposedHeading: Story = {
  name: 'the outline shows a proposed heading with accept and reject actions.',
  args: {},
}
