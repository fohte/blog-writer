import type { Meta, StoryObj } from '@storybook/react-vite'

import { MoveConflictNotice } from '#components/move-conflict-notice'

const meta = {
  component: MoveConflictNotice,
} satisfies Meta<typeof MoveConflictNotice>

export default meta
type Story = StoryObj<typeof meta>

export const StrayText: Story = {
  name: 'A concurrent sentence can move with its section or stay here.',
  args: { text: 'A sentence written while the section was offline.' },
}

export const TopLevelDestination: Story = {
  name: 'The notice names the top-level section the text belonged to.',
  args: {
    destination: { section: '## Design' },
    text: 'A sentence written while the section was offline.',
  },
}

export const NestedDestination: Story = {
  name: 'The notice names the moved section and the heading it now sits under.',
  args: {
    destination: { section: '### Keep the server simple', parent: '## Design' },
    text: 'A sentence written while the section was offline.',
  },
}

export const ChangedBeforeSelection: Story = {
  name: 'The text changes before its selection can be applied.',
  args: {
    status:
      '選択を反映する前にこの文が変わりました。変わった文を確認してください。',
    text: 'A sentence written while the section was offline.',
  },
}
