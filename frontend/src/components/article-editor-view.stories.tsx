import { Button } from '@fohte/ui/button'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { getBody, setBody, setPremise } from '#article/index'
import {
  type ArticleEditorLayout,
  type ArticleEditorPanel,
  ArticleEditorView,
} from '#components/article-editor-view'

type StoryArgs = {
  layout: ArticleEditorLayout
  initialMobilePanel: ArticleEditorPanel
  sources: boolean
  status: 'ready' | 'loading' | 'error'
}

function ArticleEditorPreview({
  layout,
  initialMobilePanel,
  sources,
  status,
}: StoryArgs) {
  const doc = useMemo(() => {
    if (status !== 'ready') return undefined
    const nextDoc = new Y.Doc()
    setBody(
      nextDoc,
      '# A clear starting point\n\nWrite the article here.\n\n## A supporting section\n\nAdd details that support the main idea.\n',
    )
    setPremise(nextDoc, 'audience', 'Readers learning the subject')
    setPremise(nextDoc, 'purpose', 'Explain one useful idea')
    setPremise(nextDoc, 'claim', 'A focused article is easier to follow')
    return nextDoc
  }, [status])

  useEffect(() => {
    if (!doc) return
    return () => {
      doc.destroy()
    }
  }, [doc])

  return (
    <ArticleEditorView
      doc={doc}
      headerActions={({ doc: articleDoc, replaceBody }) => (
        <Button
          onClick={() => {
            const body = getBody(articleDoc).toJSON()
            replaceBody(body)
          }}
          type="button"
          variant="outline"
        >
          Export
        </Button>
      )}
      initialMobilePanel={initialMobilePanel}
      layout={layout}
      onBack={() => {}}
      onTitleChange={() => {}}
      status={
        status === 'loading'
          ? { kind: 'loading' }
          : status === 'error'
            ? { kind: 'error', message: 'The article could not be opened.' }
            : undefined
      }
      sourcesPanel={
        sources ? (
          <section
            aria-label="Reference sources"
            className="flex flex-col gap-2"
          >
            <h2 className="text-xl font-semibold">Sources</h2>
            <p className="text-muted-foreground">
              Reference material appears here.
            </p>
          </section>
        ) : undefined
      }
      title="A useful article"
    />
  )
}

const meta = {
  title: 'Editor/ArticleEditorView',
  component: ArticleEditorPreview,
  args: {
    initialMobilePanel: 'body',
    layout: 'desktop',
    sources: false,
    status: 'ready',
  },
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {
  name: 'the desktop layout shows the outline, memos, premise, and article together.',
}

export const MobileArticle: Story = {
  name: 'the mobile layout opens on the article tab.',
  args: { layout: 'mobile', initialMobilePanel: 'body' },
}

export const MobileOutline: Story = {
  name: 'the mobile layout can open directly on the outline tab.',
  args: { layout: 'mobile', initialMobilePanel: 'outline' },
}

export const MobileSources: Story = {
  name: 'the mobile layout adds a sources tab when reference material is available.',
  args: {
    layout: 'mobile',
    initialMobilePanel: 'sources',
    sources: true,
  },
}

export const Opening: Story = {
  name: 'the editor shows a loading message while the article opens.',
  args: { status: 'loading' },
}

export const OpenFailed: Story = {
  name: 'the editor shows an error when the article cannot be opened.',
  args: { status: 'error' },
}
