import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { MarkdownEditor } from '#editor/index'

interface StoryArgs {
  content: string
}

function MarkdownEditorPreview({ content }: StoryArgs) {
  const { body, doc } = useMemo(() => {
    const doc = new Y.Doc()
    getBody(doc).insert(0, content)
    return { body: getBody(doc), doc }
  }, [content])

  useEffect(() => {
    return () => {
      doc.destroy()
    }
  }, [doc])

  return (
    <div style={{ height: '32rem' }}>
      <MarkdownEditor text={body} />
    </div>
  )
}

const meta = {
  title: 'Editor/MarkdownEditor',
  render: (args) => <MarkdownEditorPreview {...args} />,
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const MarkdownBody: Story = {
  name: 'the editor formats Markdown while keeping its source editable.',
  args: {
    content:
      '## A heading\n\nWrite **bold text** or `inline code` here.\n\n```ts\nconst message = "hello"\n```',
  },
}
