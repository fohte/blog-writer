import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import {
  createSuggestionLayer,
  MarkdownEditor,
  type TextSuggestion,
} from '#editor/index'
import type {
  InFlightSuggestion,
  SuggestionLayerOptions,
} from '#editor/suggestion-layer'
import { createMoveHistory, createOutlineEditorExtension } from '#outline/index'

interface StoryArgs {
  content: string
  suggestion?: TextSuggestion
  initialSelectionHead: number
  initialInFlight?: InFlightSuggestion
  display?: SuggestionLayerOptions['display']
  width?: string
}

function SuggestionEditorPreview({
  content,
  suggestion,
  initialSelectionHead,
  initialInFlight,
  display,
  width,
}: StoryArgs) {
  const { body, doc, history, layer } = useMemo(() => {
    const doc = new Y.Doc()
    const body = getBody(doc)
    body.insert(0, content)
    const history = createMoveHistory(doc)
    const layer = createSuggestionLayer({
      initialSuggestions: suggestion ? [suggestion] : [],
      onCancelInFlight: () => undefined,
      ...(initialInFlight ? { initialInFlight } : {}),
      ...(display ? { display } : {}),
    })
    return { body, doc, history, layer }
  }, [content, display, initialInFlight, initialSelectionHead, suggestion])

  useEffect(() => {
    return () => {
      history.destroy()
      doc.destroy()
    }
  }, [doc, history])

  return (
    <div style={{ height: '24rem', width }}>
      <MarkdownEditor
        extensions={[createOutlineEditorExtension(history), layer.extension]}
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
  label: 'Make it concise',
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
  name: 'the editor shows a focused paragraph suggestion as a diff with the request and actions below it.',
  args: {
    content,
    suggestion: fullLineSuggestion,
    initialSelectionHead: 4,
  },
}

export const UnfocusedWholeLine: Story = {
  name: 'the editor marks an unfocused suggestion with a margin marker and a dotted underline only.',
  args: {
    content,
    suggestion: fullLineSuggestion,
    initialSelectionHead: content.length,
  },
}

export const Generating: Story = {
  name: 'the editor underlines the requested paragraph and shows its generating bar below it.',
  args: {
    content,
    initialSelectionHead: content.length,
    initialInFlight: {
      from: content.lastIndexOf('\n') + 1,
      to: content.length,
      label: 'Make it concise',
    },
  },
}

const midLineArgs: StoryArgs = {
  content,
  suggestion: inlineSuggestion,
  initialSelectionHead: inlineSuggestion.from + 2,
}

export const MidLineRange: Story = {
  name: 'the editor outlines the paragraph around a focused suggestion that replaces words within a sentence.',
  args: midLineArgs,
}

export const AnnotatedSuggestion: Story = {
  name: 'the action band shows the note that comes with the suggestion.',
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

const seamContent = [
  'The server only stores and relays changes. It also keeps the sign-in.',
  '',
  '## Implementation',
  '',
  'Next, the first decision was how to record each change. The rest follows.',
].join('\n')
const seamFrom = seamContent.indexOf('It also')
const seamTo = seamContent.indexOf(' The rest')
const seamSuggestion: TextSuggestion = {
  id: 'transition-seam-0',
  from: seamFrom,
  to: seamTo,
  replacement: seamContent
    .slice(seamFrom, seamTo)
    .replace('sign-in.', 'sign-in. So what does each device record?')
    .replace('Next, the', 'The'),
}

export const CollapsedSeam: Story = {
  name: 'the editor shows an unfocused transition suggestion as a divider between the paragraphs.',
  args: {
    content: seamContent,
    suggestion: seamSuggestion,
    initialSelectionHead: seamContent.length,
    display: 'seam',
  },
}

export const ExpandedSeam: Story = {
  name: 'the editor shows a focused transition suggestion with actions for the sentences on both sides.',
  args: {
    content: seamContent,
    suggestion: seamSuggestion,
    initialSelectionHead: seamFrom + 1,
    display: 'seam',
  },
}
