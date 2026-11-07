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
import { PremiseProposalView } from '#components/premise-proposal-view'
import { ArticleOutline } from '#outline/article-outline'

type StoryArgs = {
  layout: ArticleEditorLayout
  initialMobilePanel: ArticleEditorPanel
  sources: boolean
  status: 'ready' | 'loading' | 'error'
  integrations: boolean
  showSyncIssue: boolean
  longOutline: boolean
  premiseOpen: boolean
}

function ArticleEditorPreview({
  layout,
  initialMobilePanel,
  sources,
  status,
  integrations,
  showSyncIssue,
  longOutline,
  premiseOpen,
}: StoryArgs) {
  const doc = useMemo(() => {
    if (status !== 'ready') return undefined
    const nextDoc = new Y.Doc()
    const articleBody = longOutline
      ? Array.from(
          { length: 24 },
          (_, index) => `## Section ${String(index + 1)}`,
        ).join('\n')
      : '# A clear starting point\n\nWrite the article here.\n\n## A supporting section\n\nAdd details that support the main idea.\n'
    setBody(nextDoc, articleBody)
    setPremise(nextDoc, 'audience', 'Readers learning the subject')
    setPremise(nextDoc, 'purpose', 'Explain one useful idea')
    setPremise(nextDoc, 'claim', 'A focused article is easier to follow')
    return nextDoc
  }, [longOutline, status])

  useEffect(() => {
    if (!doc) return
    return () => {
      doc.destroy()
    }
  }, [doc])

  return (
    <div className={layout === 'mobile' ? 'mx-auto w-full max-w-sm' : 'w-full'}>
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
          integrations ? () => [EditorView.lineWrapping] : undefined
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
        outlineRenderer={
          integrations
            ? ({ doc: articleDoc, history, onHeadingSelected, view }) => (
                <div className="flex flex-col gap-4">
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    Outline suggestion
                  </div>
                  {view ? (
                    <ArticleOutline
                      doc={articleDoc}
                      history={history}
                      onHeadingSelected={onHeadingSelected}
                      view={view}
                    />
                  ) : null}
                </div>
              )
            : undefined
        }
        onTitleChange={() => {}}
        premiseAccessory={
          premiseOpen
            ? () => (
                <PremiseProposalView
                  draft=""
                  messages={[
                    {
                      role: 'user',
                      content: 'Make the claim more specific.',
                    },
                    {
                      role: 'assistant',
                      content: 'Which decision should the article clarify?',
                    },
                  ]}
                  onAccept={() => {}}
                  onDraftChange={() => {}}
                  onReject={() => {}}
                  onSubmit={() => {}}
                  proposals={[
                    {
                      field: 'claim',
                      label: 'Claim',
                      original: 'A focused article is easier to follow',
                      replacement:
                        'A short checklist helps new maintainers catch risky changes.',
                    },
                  ]}
                />
              )
            : undefined
        }
        initialPremiseOpen={premiseOpen}
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
        syncError={
          showSyncIssue ? 'Synchronization needs attention.' : undefined
        }
        requiresAuthentication={showSyncIssue}
        onLoginAgain={showSyncIssue ? () => {} : undefined}
      />
    </div>
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
    longOutline: false,
    premiseOpen: false,
  },
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {
  name: 'the desktop layout shows the workspace without injected controls.',
}

export const DesktopWithIntegrations: Story = {
  name: 'the desktop layout places injected controls near their related content.',
  args: { integrations: true, sources: true, premiseOpen: true },
}

export const DesktopPremiseConversation: Story = {
  name: 'the open premise shows a reply and a field-level suggestion.',
  args: { premiseOpen: true },
}

export const DesktopSyncIssue: Story = {
  name: 'the desktop editor shows an unsynced article and reauthentication prompt.',
  args: { showSyncIssue: true },
}

export const DesktopLongOutline: Story = {
  name: 'the desktop layout scrolls a long outline within the left column.',
  args: { longOutline: true },
}

export const TabletLongOutline: Story = {
  name: 'the tablet layout places a long outline above the article body.',
  args: { layout: 'responsive', longOutline: true },
  globals: { viewport: { value: 'tablet' } },
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
      viewports: {
        tablet: {
          name: 'Tablet',
          styles: { width: '900px', height: '800px' },
        },
      },
    },
  },
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
