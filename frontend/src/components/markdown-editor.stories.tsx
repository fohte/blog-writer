import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { addEvidence } from '#article/evidence'
import { addSource } from '#article/sources'
import type { EvidenceVerdict } from '#article/types'
import { bodyRequestExtensions, MarkdownEditor } from '#editor/index'
import { createMoveHistory, createOutlineEditorExtension } from '#outline/index'

interface StoryEvidence {
  claim: string
  source: 0 | 1
  verdict: EvidenceVerdict
}

interface StoryArgs {
  content: string
  className?: string
  initialSelection?: { anchor: number; head?: number }
  evidence?: StoryEvidence[]
  showMoveHandles?: boolean
  showRequestMarker?: boolean
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

const noEvidence: StoryEvidence[] = []
const storySourceTitles = ['Example research report', 'Example survey']

function MarkdownEditorPreview({
  content,
  className,
  initialSelection,
  evidence = noEvidence,
  showMoveHandles = false,
  showRequestMarker = false,
}: StoryArgs) {
  const { body, doc, history, extensions } = useMemo(() => {
    const doc = new Y.Doc()
    const body = getBody(doc)
    body.insert(0, content)
    const checkedAt = '2026-02-01T00:00:00.000Z'
    if (evidence.length > 0) {
      for (const [index, title] of storySourceTitles.entries()) {
        addSource(doc, {
          id: `source-${index.toString()}`,
          kind: 'url',
          title,
          url: `https://example.invalid/report-${index.toString()}`,
          fileName: null,
          checkedAt,
          summary: 'The report describes a measured change over time.',
        })._unsafeUnwrap()
      }
    }
    for (const [index, { claim, source, verdict }] of evidence.entries()) {
      const from = content.indexOf(claim)
      addEvidence(doc, {
        id: `evidence-${index.toString()}`,
        from,
        to: from + claim.length,
        claim,
        sourceId: `source-${source.toString()}`,
        quote: 'The measured value changed during the study period.',
        verdict,
        checkedAt,
      })._unsafeUnwrap()
    }
    const history = createMoveHistory(doc)
    const extensions = [
      ...(showMoveHandles ? [createOutlineEditorExtension(history)] : []),
      ...(showRequestMarker ? bodyRequestExtensions({ doc, history }) : []),
    ]
    return { body, doc, history, extensions }
  }, [content, evidence, showMoveHandles, showRequestMarker])

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
  args: {
    content: evidenceContent,
    evidence: [{ claim: evidenceContent, source: 0, verdict: 'supported' }],
  },
}

export const NeedsReviewEvidenceMarker: Story = {
  name: 'the contradicted sentence is underlined and ends with a boxed question-mark footnote.',
  args: {
    content: evidenceContent,
    evidence: [{ claim: evidenceContent, source: 0, verdict: 'contradicted' }],
  },
}

const multiSourceContent =
  'First claim. Second claim. Third claim. Fourth claim.'

export const MultiSourceEvidenceMarkers: Story = {
  name: 'footnotes number each source in reading order, reuse a number for the same source, and skip sentences that need review.',
  args: {
    content: multiSourceContent,
    evidence: [
      { claim: 'First claim.', source: 0, verdict: 'supported' },
      { claim: 'Second claim.', source: 0, verdict: 'outdated' },
      { claim: 'Third claim.', source: 1, verdict: 'supported' },
      { claim: 'Fourth claim.', source: 0, verdict: 'supported' },
    ],
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

export const RequestMarker: Story = {
  name: 'the cursor line has a request marker beside it while the text stays in place.',
  args: {
    content: '# Overview\n\nA first paragraph.\n\nA second paragraph.\n',
    initialSelection: { anchor: 12 },
    showRequestMarker: true,
  },
}
