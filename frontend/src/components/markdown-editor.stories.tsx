import type { EditorView } from '@codemirror/view'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { okAsync } from 'neverthrow'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { addEvidence } from '#article/evidence'
import { addSource } from '#article/sources'
import type { EvidenceVerdict } from '#article/types'
import type { ArticleImageUploader } from '#editor/image-upload'
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
  focusedBlockIndex?: number
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
const blockMoveContent =
  '# Overview\n\nA first paragraph.\n\n## Details\n\nA second paragraph.\n'
const uploadArticleImage: ArticleImageUploader = () =>
  okAsync({
    src: 'https://assets.example.test/images/uploaded.webp?w=640&h=360',
  })

function MarkdownEditorPreview({
  content,
  className,
  initialSelection,
  evidence = noEvidence,
  showMoveHandles = false,
  focusedBlockIndex,
  showRequestMarker = false,
}: StoryArgs) {
  const viewRef = useRef<EditorView | null>(null)
  const focusStoryHandle = useCallback(
    (view: EditorView | null) => {
      viewRef.current = view
      if (!view) return
      if (focusedBlockIndex === undefined) {
        const active = view.dom.ownerDocument.activeElement
        if (
          active instanceof HTMLButtonElement &&
          active.matches('.cm-block-drag-handle') &&
          view.dom.contains(active)
        ) {
          view.focus()
        }
        return
      }
      const handle = [
        ...view.dom.querySelectorAll<HTMLButtonElement>(
          '.cm-block-drag-handle',
        ),
      ][focusedBlockIndex]
      handle?.focus()
    },
    [focusedBlockIndex],
  )
  useEffect(() => {
    if (viewRef.current) focusStoryHandle(viewRef.current)
  }, [focusStoryHandle])
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
        uploadArticleImage={uploadArticleImage}
        {...(className === undefined ? {} : { className })}
        {...(initialSelection ? { initialSelection } : {})}
        onViewChange={focusStoryHandle}
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
  name: 'links and strikethrough are decorated while the GFM table is drawn.',
  args: {
    content: otherSyntaxContent,
    initialSelection: { anchor: otherSyntaxContent.length },
  },
}

const tableContent = [
  '| Feature | Offline |',
  '| :--- | ---: |',
  '| Tables | Yes |',
  '| Diagrams | Yes |',
].join('\n')
const tablePreviewContent = `${tableContent}\n\nA paragraph after the table.`
const blockPreviewTableContent = [
  '| Feature | Offline |',
  '| :--- | ---: |',
  '| Preview | Yes |',
].join('\n')
const imageDataUrl =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='320'%20height='180'%3E%3Crect%20width='320'%20height='180'%20fill='%23dbeafe'/%3E%3C/svg%3E"
const imageContent = `![Sample image](${imageDataUrl})`
const imagePreviewContent = `${imageContent}\n\nA paragraph after the image.`
const mermaidContent = '```mermaid\ngraph LR\n  Draft --> Preview\n```'
const mermaidPreviewContent = `${mermaidContent}\n\nA paragraph after the diagram.`
const blockPreviewMoveContent = [
  'A paragraph before the rendered blocks.',
  '',
  blockPreviewTableContent,
  '',
  imageContent,
  '',
  mermaidContent,
].join('\n')

export const TablePreview: Story = {
  name: 'the editor draws a GFM table while the cursor is outside it.',
  args: {
    content: tablePreviewContent,
    initialSelection: { anchor: tableContent.length + 2 },
  },
}

export const CursorInTable: Story = {
  name: 'the editor reveals the original table Markdown when the cursor enters it.',
  args: {
    content: tableContent,
    initialSelection: { anchor: tableContent.indexOf('Tables') + 2 },
  },
}

export const ImagePreview: Story = {
  name: 'the editor draws an image while keeping its original Markdown unchanged.',
  args: {
    content: imagePreviewContent,
    initialSelection: { anchor: imageContent.length + 2 },
  },
}

export const CursorInImage: Story = {
  name: 'the editor shows the image source and preview while the cursor is inside it.',
  args: {
    content: imageContent,
    initialSelection: { anchor: imageContent.indexOf('Sample') + 2 },
  },
}

export const MermaidPreview: Story = {
  name: 'the editor draws a Mermaid diagram while the cursor is outside its source.',
  args: {
    content: mermaidPreviewContent,
    initialSelection: { anchor: mermaidContent.length + 2 },
  },
}

export const CursorInMermaid: Story = {
  name: 'the editor keeps the Mermaid source visible above its diagram preview.',
  args: {
    content: mermaidContent,
    initialSelection: { anchor: mermaidContent.indexOf('Draft') + 2 },
  },
}

export const MermaidSyntaxError: Story = {
  name: 'the editor shows Mermaid source and a parser error for an invalid diagram.',
  args: {
    content: '```mermaid\ngraph LR\n  Draft -->\n```',
    initialSelection: { anchor: 0 },
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
    content: blockMoveContent,
    initialSelection: { anchor: 0 },
    showMoveHandles: true,
  },
}

export const BlockMoveHandlesInsidePreviews: Story = {
  name: 'the editor shows move handles inside rendered tables, images, and Mermaid diagrams.',
  args: {
    content: blockPreviewMoveContent,
    initialSelection: { anchor: 1 },
    showMoveHandles: true,
  },
}

export const KeyboardFocusedBlockHandle: Story = {
  name: 'the editor shows a keyboard-focused block move handle.',
  args: {
    content: blockMoveContent,
    focusedBlockIndex: 0,
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
