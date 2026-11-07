import type { Meta, StoryObj } from '@storybook/react-vite'

import { MobileEditorToolbar } from '#components/mobile-editor-toolbar'

const meta = {
  title: 'Editor/MobileEditorToolbar',
  component: MobileEditorToolbar,
  decorators: [
    (Story) => (
      <div className="flex h-80 w-97.5 flex-col justify-end">
        <Story />
      </div>
    ),
  ],
  args: {
    onShowMemo: () => {},
    onShowOutline: () => {},
    moveActions: [],
    moveMenuOpen: false,
    onMove: () => {},
    onMoveMenuOpenChange: () => {},
    onUndo: () => {},
    onRedo: () => {},
  },
} satisfies Meta<typeof MobileEditorToolbar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'the toolbar offers the request, memo, outline, move, undo, and redo.',
  args: { onRequest: () => {} },
}

export const WithoutRequest: Story = {
  name: 'the toolbar leaves out the request when the editor cannot send one.',
}

export const MoveMenuOpen: Story = {
  name: 'the move menu lists the moves for the heading at the cursor.',
  args: {
    onRequest: () => {},
    moveMenuOpen: true,
    moveActions: [
      { label: 'Move up', input: { from: 20, destination: 0 } },
      { label: 'Move down', input: undefined },
      {
        label: 'Make child',
        input: { from: 20, destination: 20, childOf: 0 },
      },
    ],
  },
}
