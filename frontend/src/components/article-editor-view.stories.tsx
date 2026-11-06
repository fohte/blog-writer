import { EditorView } from '@codemirror/view'
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
  integrations: boolean
  showSyncIssue: boolean
}

function ArticleEditorPreview({
  layout,
  initialMobilePanel,
  sources,
  status,
  integrations,
  showSyncIssue,
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
      articleId="story-article"
      doc={doc}
      bodyAccessory={
        integrations
          ? () => (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                Draft request
              </div>
            )
          : undefined
      }
      editorExtensions={
        integrations
          ? () => [
              EditorView.theme({
                '.cm-content': {
                  borderLeft: '3px solid var(--primary)',
                  paddingLeft: '0.5rem',
                },
              }),
            ]
          : undefined
      }
      headerActions={
        integrations
          ? ({ doc: articleDoc, replaceBody }) => (
              <Button
                onClick={() => {
                  const body = getBody(articleDoc).toJSON()
                  replaceBody(body).match(
                    () => undefined,
                    () => undefined,
                  )
                }}
                type="button"
                variant="outline"
              >
                Export
              </Button>
            )
          : undefined
      }
      initialMobilePanel={initialMobilePanel}
      layout={layout}
      onBack={() => {}}
      onViewChange={integrations ? () => {} : undefined}
      outlineAccessory={
        integrations
          ? () => (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                Outline suggestion
              </div>
            )
          : undefined
      }
      onTitleChange={() => {}}
      premiseAccessory={
        integrations
          ? () => (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm sm:col-span-3">
                Premise guidance
              </div>
            )
          : undefined
      }
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
      syncStatus={showSyncIssue ? 'unsynced' : undefined}
      syncError={showSyncIssue ? 'Synchronization needs attention.' : undefined}
      requiresAuthentication={showSyncIssue}
      onLoginAgain={showSyncIssue ? () => {} : undefined}
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
    integrations: false,
    showSyncIssue: false,
  },
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {
  name: 'the desktop layout shows the workspace without injected controls.',
}

export const DesktopWithIntegrations: Story = {
  name: 'the desktop layout places injected controls near their related content.',
  args: { integrations: true, sources: true },
}

export const DesktopSyncIssue: Story = {
  name: 'the desktop editor shows an unsynced article and reauthentication prompt.',
  args: { showSyncIssue: true },
}

export const MobileArticle: Story = {
  name: 'the mobile layout opens on the article tab without injected controls.',
  args: { layout: 'mobile', initialMobilePanel: 'body' },
}

export const MobileMemo: Story = {
  name: 'the mobile layout opens the memo tab with its empty state.',
  args: { layout: 'mobile', initialMobilePanel: 'memo' },
}

export const MobileArticleWithIntegrations: Story = {
  name: 'the mobile article tab keeps the injected request inside the article panel.',
  args: {
    integrations: true,
    layout: 'mobile',
    initialMobilePanel: 'body',
  },
}

export const MobileOutline: Story = {
  name: 'the mobile layout opens on the outline tab without injected controls.',
  args: { layout: 'mobile', initialMobilePanel: 'outline' },
}

export const MobileOutlineWithIntegrations: Story = {
  name: 'the mobile outline tab places outline suggestions above the outline.',
  args: {
    integrations: true,
    layout: 'mobile',
    initialMobilePanel: 'outline',
  },
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
