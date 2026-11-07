import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import {
  createSuggestionLayer,
  MarkdownEditor,
  type SuggestionPosition,
  type TextSuggestion,
} from '#editor/index'
import { createMoveHistory } from '#outline/index'

interface StoryArgs {
  content: string
  suggestion?: TextSuggestion
  initialSelectionHead: number
  initialInFlight?: SuggestionPosition
  width?: string
}

function SuggestionEditorPreview({
  content,
  suggestion,
  initialSelectionHead,
  initialInFlight,
  width,
}: StoryArgs) {
  const { body, doc, history, layer } = useMemo(() => {
    const doc = new Y.Doc()
    const body = getBody(doc)
    body.insert(0, content)
    const history = createMoveHistory(doc)
    const layer = createSuggestionLayer({
      initialSuggestions: suggestion ? [suggestion] : [],
      ...(initialInFlight ? { initialInFlight } : {}),
    })
    return { body, doc, history, layer }
  }, [content, initialInFlight, initialSelectionHead, suggestion])

  useEffect(() => {
    return () => {
      history.destroy()
      doc.destroy()
    }
  }, [doc, history])

  return (
    <div style={{ height: '24rem', width }}>
      <MarkdownEditor
        extensions={[layer.extension]}
        history={history}
        initialSelection={{ anchor: initialSelectionHead }}
        text={body}
      />
    </div>
  )
}

const content = [
  'The editor keeps the current article text until a suggestion is accepted.',
  '',
  'A second paragraph keeps the cursor outside the proposal.',
].join('\n')
const firstLineLength = content.indexOf('\n')
const fullLineSuggestion: TextSuggestion = {
  id: 'suggestion-a',
  from: 0,
  to: firstLineLength,
  replacement:
    'The editor preserves the article until its writer accepts a suggestion.',
}
const inlineSuggestion: TextSuggestion = {
  id: 'suggestion-b',
  from: content.indexOf('current article text'),
  to: content.indexOf('current article text') + 'current article text'.length,
  replacement: 'existing draft',
}

const meta = {
  title: 'Editor/SuggestionLayer',
  render: (args) => <SuggestionEditorPreview {...args} />,
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const FocusedWholeLine: Story = {
  name: 'the editor shows a focused whole-line suggestion with review controls.',
  args: {
    content,
    suggestion: fullLineSuggestion,
    initialSelectionHead: 4,
  },
}

export const UnfocusedWholeLine: Story = {
  name: 'the editor shows a whole-line suggestion without review controls.',
  args: {
    content,
    suggestion: fullLineSuggestion,
    initialSelectionHead: content.length,
  },
}

export const Generating: Story = {
  name: 'the editor shows a pending suggestion at the end of the paragraph.',
  args: {
    content,
    initialSelectionHead: content.length,
    initialInFlight: { from: content.length, to: content.length },
  },
}

const midLineArgs: StoryArgs = {
  content,
  suggestion: inlineSuggestion,
  initialSelectionHead: inlineSuggestion.from + 2,
}

export const MidLineRange: Story = {
  name: 'the editor shows a suggestion that replaces words within a sentence.',
  args: midLineArgs,
}

export const AnnotatedSuggestion: Story = {
  name: 'the editor shows a one-line note with the suggestion diff.',
  args: {
    ...midLineArgs,
    suggestion: {
      ...inlineSuggestion,
      metadata: { sourceIds: ['source-a'] },
      note: '根拠の資料: Sample source',
    },
  },
}

export const NarrowMidLineRange: Story = {
  name: 'the editor shows an inline suggestion in a 20rem-wide view.',
  args: { ...midLineArgs, width: '20rem' },
}
