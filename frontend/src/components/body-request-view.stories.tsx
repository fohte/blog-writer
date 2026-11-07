import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ComponentProps, useState } from 'react'

import { BodyRequestView } from '#components/body-request-view'

function BodyRequestStory(args: ComponentProps<typeof BodyRequestView>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  return (
    <>
      <article className="mx-auto max-w-2xl rounded-md border border-border p-8">
        <h1 className="mb-4 text-xl font-semibold">Article title</h1>
        <p className="mb-3 text-sm text-muted-foreground">
          Select a sentence in the article to request a revision.
        </p>
        <p ref={setAnchor}>
          This paragraph is selected and ready for a short request.
        </p>
      </article>
      <BodyRequestView {...args} anchor={anchor} />
    </>
  )
}

const meta = {
  component: BodyRequestView,
  render: (args) => <BodyRequestStory {...args} />,
  args: {
    anchor: null,
    open: true,
    touchDevice: false,
    phase: 'input',
    instruction: '',
    onOpenChange: () => {},
    onInstructionChange: () => {},
    onSubmit: () => {},
  },
} satisfies Meta<typeof BodyRequestView>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyToRequest: Story = {
  name: 'the writer can enter a request for the selected text',
  args: { instruction: 'この段落を短くしてください' },
}

export const TouchRequest: Story = {
  name: 'a touch device shows a request button',
  args: { touchDevice: true },
}

export const Failed: Story = {
  name: 'a failed request shows an error',
  args: {
    phase: 'error',
    instruction: 'この段落を短くしてください',
    error: '提案を作成できませんでした。',
  },
}
