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
  className?: string
  initialSelection?: { anchor: number; head?: number }
  evidenceVerdict?: EvidenceVerdict
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
  className,
  initialSelection,
  evidenceVerdict,
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
        claim: content,
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
  }, [content, evidenceVerdict, showMoveHandles])

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
        {...(className === undefined ? {} : { className })}
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
  name: 'the editor shows heading and inline code markers while hiding bold and link markers with the cursor at the end.',
  args: {
    content: defaultContent,
    initialSelection: { anchor: defaultContent.length },
  },
}

export const CallerProvidedHeight: Story = {
  name: 'the editor uses a height supplied by its caller.',
  args: {
    content: 'The editor takes its height from the class name.',
    className: 'h-60',
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
  name: 'the supported sentence ends with the footnote number of its source.',
  args: { content: evidenceContent, evidenceVerdict: 'supported' },
}

export const NeedsReviewEvidenceMarker: Story = {
  name: 'the contradicted sentence is underlined and ends with a boxed question-mark footnote.',
  args: { content: evidenceContent, evidenceVerdict: 'contradicted' },
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
