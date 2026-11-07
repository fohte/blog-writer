import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { setPremise } from '#article/index'
import { ArticlePremisePanel } from '#components/article-premise-panel'

type StoryArgs = {
  filled: boolean
}

function ArticlePremisePanelPreview({ filled }: StoryArgs) {
  const doc = useMemo(() => {
    const nextDoc = new Y.Doc()
    if (filled) {
      setPremise(nextDoc, 'audience', 'Readers learning the subject')
      setPremise(nextDoc, 'purpose', 'Explain one useful idea')
      setPremise(nextDoc, 'claim', 'A focused article is easier to follow')
    }
    return nextDoc
  }, [filled])

  useEffect(
    () => () => {
      doc.destroy()
    },
    [doc],
  )

  return (
    <div className="max-w-85">
      <ArticlePremisePanel doc={doc} />
    </div>
  )
}

const meta = {
  component: ArticlePremisePanelPreview,
  args: { filled: true },
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Filled: Story = {
  name: 'the premise panel shows the saved reader, purpose, and claim.',
}

export const Empty: Story = {
  name: 'the premise panel shows empty reader, purpose, and claim fields before they are decided.',
  args: { filled: false },
}
