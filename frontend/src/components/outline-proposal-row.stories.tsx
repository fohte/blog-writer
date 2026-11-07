import { List } from '@fohte/ui/list'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineProposalRow } from '#components/outline-proposal-row'

const meta = {
  component: OutlineProposalRow,
  args: {
    depth: 1,
    level: 3,
    proposal: {
      id: 'proposal-a',
      from: 0,
      to: 0,
      replacement: '### Test conditions',
    },
    onProposalAccept: () => {},
    onProposalReject: () => {},
  },
  render: (args) => (
    <div className="w-72">
      <List aria-label="Headings" role="listbox">
        <OutlineProposalRow {...args} />
      </List>
    </div>
  ),
} satisfies Meta<typeof OutlineProposalRow>

export default meta
type Story = StoryObj<typeof meta>

export const ProposedHeading: Story = {
  name: 'a proposed new heading is green with accept and reject buttons',
}

export const RenamedHeading: Story = {
  name: 'a proposed rename strikes the current heading above the new one',
  args: {
    depth: 0,
    level: 2,
    original: 'Wrap-up',
    proposal: { id: 'proposal-b', from: 0, to: 11, replacement: '## Lessons' },
  },
}

export const DeletedHeading: Story = {
  name: 'a proposed deletion strikes the current heading',
  args: {
    depth: 0,
    level: 2,
    original: 'Wrap-up',
    proposal: { id: 'proposal-c', from: 0, to: 11, replacement: '' },
  },
}
