import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { addEvidence } from '#article/evidence'
import { addSource } from '#article/sources'
import type { EvidenceVerdict } from '#article/types'
import { MarkdownEditor } from '#editor/index'
import { createMoveHistory, createOutlineEditorExtension } from '#outline/index'

interface StoryArgs {
  content: string
  initialSelection?: { anchor: number; head?: number }
  evidenceVerdict?: EvidenceVerdict
  evidenceEdited?: boolean
  showMoveHandles?: boolean
}

const defaultContent = [
  '## A heading',
  '',
  'Write **bold text** or `inline code` here, and follow [a link](https://example.test).',
  '',
  '```ts',
  'const message = "hello"',
  '```',
].join('\n')

const headingContent =
  '# A heading\n\nMove the cursor to reveal the heading marker.'
const boldContent = 'This is **bold text**.'
const otherSyntaxContent = [
  '## More Markdown',
  '',
  'Visit [the project](https://example.test) and ~~review~~ the changes.',
  '',
  '- [x] Reviewed formatting',
  '- [ ] Check the task list',
  '',
  '| Feature | Rendering |',
  '| --- | --- |',
  '| Table | Plain text |',
  '',
  '> The blockquote stays as source text.',
].join('\n')

function MarkdownEditorPreview({
  content,
  initialSelection,
  evidenceVerdict,
  evidenceEdited,
  showMoveHandles = false,
}: StoryArgs) {
  const { body, doc, history, extensions } = useMemo(() => {
    const doc = new Y.Doc()
    const body = getBody(doc)
    body.insert(0, content)
    if (evidenceVerdict !== undefined) {
      const checkedAt = '2026-02-01T00:00:00.000Z'
      addSource(doc, {
        id: 'source-example',
        kind: 'url',
        title: 'Example research report',
        url: 'https://example.invalid/report',
        fileName: null,
        checkedAt,
        summary: 'The report describes a measured change over time.',
      })._unsafeUnwrap()
      addEvidence(doc, {
        id: 'evidence-example',
        from: 0,
        to: content.length,
        claim: evidenceEdited === true ? 'An earlier sentence.' : content,
        sourceId: 'source-example',
        quote: 'The measured value changed during the study period.',
        verdict: evidenceVerdict,
        checkedAt,
      })._unsafeUnwrap()
    }
    const history = createMoveHistory(doc)
    const extensions = showMoveHandles
      ? [createOutlineEditorExtension(history)]
      : []
    return { body, doc, history, extensions }
  }, [content, evidenceEdited, evidenceVerdict, showMoveHandles])

  useEffect(() => {
    return () => {
      history.destroy()
      doc.destroy()
    }
  }, [doc, history])

  return (
    <div style={{ height: '32rem' }}>
      <MarkdownEditor
        text={body}
        history={history}
        extensions={extensions}
        {...(initialSelection ? { initialSelection } : {})}
      />
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
  name: 'the editor hides Markdown markers while the cursor is at the end.',
  args: {
    content: defaultContent,
    initialSelection: { anchor: defaultContent.length },
  },
}

export const CursorInHeading: Story = {
  name: 'the cursor reveals the heading marker for editing.',
  args: {
    content: headingContent,
    initialSelection: { anchor: headingContent.indexOf('A heading') + 2 },
  },
}

export const CursorInBoldSpan: Story = {
  name: 'the cursor reveals the bold delimiters for editing.',
  args: {
    content: boldContent,
    initialSelection: { anchor: boldContent.indexOf('bold text') + 2 },
  },
}

export const OtherMarkdownSyntax: Story = {
  name: 'links and strikethrough are decorated while block Markdown stays as text.',
  args: {
    content: otherSyntaxContent,
    initialSelection: { anchor: otherSyntaxContent.length },
  },
}

const evidenceContent = 'A research sentence.'

export const SupportedEvidenceMarker: Story = {
  name: 'the sentence ends with a green supported marker.',
  args: { content: evidenceContent, evidenceVerdict: 'supported' },
}

export const NeedsReviewEvidenceMarker: Story = {
  name: 'the sentence ends with a yellow marker for a contradiction.',
  args: { content: evidenceContent, evidenceVerdict: 'contradicted' },
}

export const EditedEvidenceMarker: Story = {
  name: 'the sentence ends with a yellow marker after it changes.',
  args: {
    content: evidenceContent,
    evidenceVerdict: 'supported',
    evidenceEdited: true,
  },
}

export const BlockMoveHandles: Story = {
  name: 'the editor shows drag handles beside Markdown blocks.',
  args: {
    content:
      '# Overview\n\nA first paragraph.\n\n## Details\n\nA second paragraph.\n',
    initialSelection: { anchor: 0 },
    showMoveHandles: true,
  },
}
