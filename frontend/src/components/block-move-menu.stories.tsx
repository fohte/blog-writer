import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef } from 'react'

import { BlockMoveMenu } from '#components/block-move-menu'

interface StoryArgs {
  open: boolean
  firstBlock: boolean
}

function BlockMoveMenuPreview({ firstBlock, open }: StoryArgs) {
  const anchor = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Move paragraph"
        className="rounded p-2 text-muted-foreground hover:bg-accent"
        ref={anchor}
        type="button"
      >
        ⠿
      </button>
      <BlockMoveMenu
        actions={[
          {
            label: 'Move up',
            input: firstBlock ? undefined : { from: 20, destination: 0 },
          },
          { label: 'Move down', input: { from: 20, destination: 40 } },
        ]}
        anchor={anchor}
        onMove={() => {}}
        onOpenChange={() => {}}
        open={open}
      />
    </>
  )
}

const meta = {
  title: 'Editor/BlockMoveMenu',
  component: BlockMoveMenuPreview,
  args: { firstBlock: false, open: true },
} satisfies Meta<typeof BlockMoveMenuPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  name: 'the block handle shows the available moves.',
}

export const FirstBlock: Story = {
  args: { firstBlock: true },
  name: 'the first block cannot move up.',
}
