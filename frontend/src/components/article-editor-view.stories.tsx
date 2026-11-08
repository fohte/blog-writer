import { EditorView } from '@codemirror/view'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'

import { setBody, setPremise } from '#article/index'
import {
  type ArticleEditorPanel,
  ArticleEditorView,
  type ArticleEditorViewProps,
} from '#components/article-editor-view'
import { ArticleFileSyncBannerView } from '#components/article-file-sync-banner-view'
import { ArticlePremisePanel } from '#components/article-premise-panel'
import { ArticleOutline } from '#outline/article-outline'

type StoryArgs = {
  layout: NonNullable<ArticleEditorViewProps['layout']>
  initialPanel: ArticleEditorPanel
  sources: boolean
  status: 'ready' | 'loading' | 'error'
  integrations: boolean
  showSyncIssue: boolean
  longOutline: boolean
  empty: boolean
}

function ArticleEditorPreview({
  layout,
  initialPanel,
  sources,
  status,
  integrations,
  showSyncIssue,
  longOutline,
  empty,
}: StoryArgs) {
  const doc = useMemo(() => {
    if (status !== 'ready') return undefined
    const nextDoc = new Y.Doc()
    if (empty) return nextDoc
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
  }, [empty, longOutline, status])

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
        articleNotice={
          integrations
            ? () => (
                <ArticleFileSyncBannerView
                  canImport
                  onChangePath={() => {}}
                  onImport={() => {}}
                  onOverwrite={() => {}}
                  onShowDiff={() => {}}
                  onUndo={() => {}}
                  path="notes/example.md"
                  state="external_changed"
                />
              )
            : undefined
        }
        exportScreen={integrations ? () => null : undefined}
        onRequest={integrations ? () => {} : undefined}
        initialPanel={initialPanel}
        layout={layout}
        onBack={() => {}}
        onOpenSettings={() => {}}
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
        premisePanel={
          initialPanel === 'premise'
            ? ({ doc: articleDoc }) => (
                <ArticlePremisePanel
                  discussion={{
                    cancelled: false,
                    draft: '',
                    elapsedSeconds: 0,
                    error: undefined,
                    generating: false,
                    messages: [
                      {
                        role: 'user',
                        content: 'Make the claim more specific.',
                      },
                      {
                        role: 'assistant',
                        content: 'Which decision should the article clarify?',
                      },
                    ],
                    onAccept: () => {},
                    onCancel: () => {},
                    onDraftChange: () => {},
                    onReject: () => {},
                    onSubmit: () => {},
                    proposals: {
                      claim:
                        'A short checklist helps new maintainers catch risky changes.',
                    },
                  }}
                  doc={articleDoc}
                />
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
    initialPanel: 'body',
    layout: 'desktop',
    sources: false,
    status: 'ready',
    integrations: false,
    showSyncIssue: false,
    longOutline: false,
    empty: false,
  },
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {
  name: 'the desktop layout shows the outline, the article, and the memo tab side by side.',
}

export const DesktopWithIntegrations: Story = {
  name: 'the desktop layout places injected controls near their related content with the sources tab open.',
  args: { integrations: true, sources: true, initialPanel: 'sources' },
}

export const DesktopPremiseConversation: Story = {
  name: 'the premise tab shows the premise fields, a reply, and a field-level suggestion.',
  args: { initialPanel: 'premise' },
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
  name: 'the tablet layout places a long outline above the article body',
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
  name: 'the mobile layout shows the article full screen with the toolbar at the bottom.',
  args: { layout: 'mobile', initialPanel: 'body' },
}

export const MobileMemo: Story = {
  name: 'the mobile memo screen covers the article and shows its empty state.',
  args: { layout: 'mobile', initialPanel: 'memo' },
}

export const MobileArticleWithIntegrations: Story = {
  name: 'the mobile article keeps the injected request inside the article and offers a request in the toolbar.',
  args: {
    integrations: true,
    layout: 'mobile',
    initialPanel: 'body',
  },
}

export const MobileOutline: Story = {
  name: 'the mobile outline screen covers the article with a way back to the body.',
  args: { layout: 'mobile', initialPanel: 'outline' },
}

export const MobileOutlineWithIntegrations: Story = {
  name: 'the mobile outline screen places outline suggestions above the outline.',
  args: {
    integrations: true,
    layout: 'mobile',
    initialPanel: 'outline',
  },
}

export const MobileSources: Story = {
  name: 'the mobile sources screen shows the reference material.',
  args: {
    layout: 'mobile',
    initialPanel: 'sources',
    sources: true,
  },
}

export const Opening: Story = {
  name: 'the editor shows gray placeholder lines in the article column while the article opens.',
  args: { status: 'loading' },
}

export const OpenFailed: Story = {
  name: 'the editor shows an error when the article cannot be opened.',
  args: { status: 'error' },
}

export const EmptyArticle: Story = {
  name: 'the empty article invites the writer to start with a memo or the premise.',
  args: { empty: true },
}
