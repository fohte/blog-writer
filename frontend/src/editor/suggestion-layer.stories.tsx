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

interface StoryArgs {
  content: string
  suggestion?: TextSuggestion
  initialSelectionHead: number
  initialInFlight?: SuggestionPosition
}

function SuggestionEditorPreview({
  content,
  suggestion,
  initialSelectionHead,
  initialInFlight,
}: StoryArgs) {
  const { body, doc, layer } = useMemo(() => {
    const doc = new Y.Doc()
    const body = getBody(doc)
    body.insert(0, content)
    const layer = createSuggestionLayer({
      initialSuggestions: suggestion ? [suggestion] : [],
      initialSelectionHead,
      ...(initialInFlight ? { initialInFlight } : {}),
    })
    return { body, doc, layer }
  }, [content, initialInFlight, initialSelectionHead, suggestion])

  useEffect(() => {
    return () => {
      doc.destroy()
    }
  }, [doc])

  return (
    <div style={{ height: '24rem' }}>
      <MarkdownEditor
        extensions={[layer.extension]}
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

export const MidLineRange: Story = {
  name: 'the editor shows a suggestion that replaces words within a sentence.',
  args: {
    content,
    suggestion: inlineSuggestion,
    initialSelectionHead: inlineSuggestion.from + 2,
  },
}
