import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ComponentProps, useState } from 'react'

import {
  type BodyRequestCandidate,
  BodyRequestView,
} from '#components/body-request-view'

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

const candidates: readonly BodyRequestCandidate[] = [
  { id: 'concise', label: '簡潔にする', group: 'edit' },
  { id: 'add-example', label: '例を 1 つ足す', group: 'edit' },
  { id: 'smooth-flow', label: '前後とのつながりを直す', group: 'edit' },
  { id: 'verify-claims', label: '根拠を確かめる', group: 'research' },
  {
    id: 'research-section',
    label: 'この見出しについて調べる',
    group: 'research',
  },
  { id: 'write-from-sources', label: '資料をもとに書く', group: 'research' },
]

const meta = {
  component: BodyRequestView,
  render: (args) => <BodyRequestStory {...args} />,
  args: {
    anchor: null,
    open: true,
    touchDevice: false,
    phase: 'input',
    instruction: '',
    target: 'paragraph',
    candidates,
    onOpenChange: () => {},
    onInstructionChange: () => {},
    onSubmit: () => {},
  },
} satisfies Meta<typeof BodyRequestView>

export default meta
type Story = StoryObj<typeof meta>

export const EmptyRequest: Story = {
  name: 'an empty request lists edit and research candidates with the first one highlighted',
  args: { defaultHighlightedId: 'concise' },
}

export const ReadyToRequest: Story = {
  name: 'the writer can type a request for the paragraph at the cursor',
  args: { instruction: 'この段落を短くしてください' },
}

export const SelectionTarget: Story = {
  name: 'a request for selected text names the selection as its target',
  args: { target: 'selection' },
}

export const InsertionTarget: Story = {
  name: 'a request on a blank line names an insertion as its target',
  args: { target: 'insertion' },
}

export const TouchRequest: Story = {
  name: 'a touch device shows a request button',
  args: { open: false, touchDevice: true },
}

export const Failed: Story = {
  name: 'a failed request shows the reason with retry and close buttons',
  args: {
    phase: 'error',
    instruction: 'この段落を短くしてください',
    failure: { title: '作成できませんでした', reason: '利用枠に達しました' },
    onRetry: () => {},
  },
}
