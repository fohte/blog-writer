import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@fohte/ui/tabs'
import { err, ok, type Result } from 'neverthrow'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type * as Y from 'yjs'

import { getBody } from '#article/index'
import { ArticleBody } from '#components/article-body'
import {
  getCachedEditorExtensions,
  getMoveHistory,
  useEmptyArticle,
} from '#components/article-editor-document'
import { ArticleEditorHeader } from '#components/article-editor-header'
import { ArticleEditorMobileToolbar } from '#components/article-editor-mobile-toolbar'
import type { ArticleExportSection } from '#components/article-export-screen'
import { ArticlePremisePanel } from '#components/article-premise-panel'
import { EditorStatusBar } from '#components/editor-status-bar'
import type { MarkdownEditorHandle } from '#components/markdown-editor'
import { MarkdownEditor } from '#components/markdown-editor'
import { ReauthenticationPrompt } from '#components/reauthentication-prompt'
import { moveConflictExtension } from '#editor/index'
import { useMobileViewport } from '#hooks/use-mobile-viewport'
import type { SyncState } from '#lib/sync-client'
import { MemoPanel } from '#memos/memo-panel'
import {
  ArticleOutline,
  createOutlineEditorExtension,
  type MoveHistory,
} from '#outline/index'

export type ArticleEditorPanel =
  'memo' | 'outline' | 'body' | 'premise' | 'sources'
type ArticleEditorLayout = 'responsive' | 'mobile' | 'desktop'
export type ArticleEditorContext = {
  articleId: string
  doc: Y.Doc
  history: MoveHistory
  view: EditorView | null
  replaceBody: (value: string) => Result<void, EditorNotReadyError>
  showSources: () => void
  openExport: (section?: ArticleExportSection) => void
}
export type ArticleExportContext = ArticleEditorContext & {
  section: ArticleExportSection | undefined
  syncStatus: SyncState | undefined
  onBack: () => void
}
type ArticleOutlineRenderContext = ArticleEditorContext & {
  onHeadingSelected: () => void
}

class EditorNotReadyError extends Error {
  constructor() {
    super('The article editor is not ready')
    this.name = 'EditorNotReadyError'
  }
}

function isArticleEditorPanel(value: string): value is ArticleEditorPanel {
  return (
    value === 'memo' ||
    value === 'outline' ||
    value === 'body' ||
    value === 'premise' ||
    value === 'sources'
  )
}

function isSidePanel(value: ArticleEditorPanel) {
  return value === 'memo' || value === 'premise' || value === 'sources'
}

export interface ArticleEditorViewProps {
  articleId: string
  title: string
  doc?: Y.Doc | undefined
  status?: { kind: 'loading' } | { kind: 'error'; message: string } | undefined
  layout?: ArticleEditorLayout
  initialPanel?: ArticleEditorPanel
  /** Keeps extension instances stable by calling the factory once per article document. */
  editorExtensions?:
    ((context: { doc: Y.Doc; history: MoveHistory }) => Extension[]) | undefined
  bodyAccessory?: ((context: ArticleEditorContext) => ReactNode) | undefined
  /** Opens the body request from the mobile toolbar; the toolbar hides the request button without it. */
  onRequest?: ((context: ArticleEditorContext) => void) | undefined
  outlineRenderer?:
    ((context: ArticleOutlineRenderContext) => ReactNode) | undefined
  premisePanel?: ((context: ArticleEditorContext) => ReactNode) | undefined
  /** Renders above every panel so the writer notices it whichever panel is open. */
  articleNotice?: ((context: ArticleEditorContext) => ReactNode) | undefined
  exportScreen?: ((context: ArticleExportContext) => ReactNode) | undefined
  sourcesPanel?:
    ReactNode | ((context: ArticleEditorContext) => ReactNode) | undefined
  onViewChange?: ((view: EditorView | null) => void) | undefined
  syncStatus?: SyncState | undefined
  syncError?: string | undefined
  requiresAuthentication?: boolean | undefined
  onLoginAgain?: (() => void) | undefined
  onTitleChange: (title: string) => void
  onBack: () => void
  onOpenSettings: () => void
}

export type ArticleEditorIntegrationProps = Pick<
  ArticleEditorViewProps,
  | 'bodyAccessory'
  | 'editorExtensions'
  | 'exportScreen'
  | 'articleNotice'
  | 'onRequest'
  | 'onViewChange'
  | 'outlineRenderer'
  | 'premisePanel'
  | 'sourcesPanel'
>

const emptyExtensions: Extension[] = []

export function ArticleEditorView({
  articleId,
  title,
  doc,
  status,
  layout = 'responsive',
  initialPanel = 'body',
  editorExtensions,
  bodyAccessory,
  onRequest,
  outlineRenderer,
  premisePanel,
  articleNotice,
  exportScreen,
  sourcesPanel,
  onViewChange,
  syncStatus,
  syncError,
  requiresAuthentication = false,
  onLoginAgain,
  onTitleChange,
  onBack,
  onOpenSettings,
}: ArticleEditorViewProps) {
  const viewportIsMobile = useMobileViewport()
  const isMobile =
    layout === 'mobile' || (layout === 'responsive' && viewportIsMobile)
  const [panel, setPanel] = useState<ArticleEditorPanel>(initialPanel)
  const [exportView, setExportView] = useState<{
    section: ArticleExportSection | undefined
  }>()
  const isEmpty = useEmptyArticle(doc)
  const history = doc ? getMoveHistory(doc) : undefined
  const body = doc ? getBody(doc) : undefined
  const [view, setView] = useState<EditorView | null>(null)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const suppliedExtensions =
    doc && history && editorExtensions
      ? getCachedEditorExtensions(doc, history, editorExtensions)
      : emptyExtensions
  const extensions = useMemo(
    () =>
      doc && history
        ? [
            moveConflictExtension(doc),
            createOutlineEditorExtension(history),
            ...suppliedExtensions,
          ]
        : [],
    [doc, history, suppliedExtensions],
  )

  useEffect(() => {
    return () => {
      history?.destroy()
    }
  }, [history])

  const replaceBody = (value: string) => {
    if (!editorViewRef.current || !editorRef.current)
      return err(new EditorNotReadyError())
    editorRef.current.replaceBody(value)
    return ok(undefined)
  }

  const showSources = () => {
    setPanel('sources')
  }
  const openExport = (section?: ArticleExportSection) => {
    setExportView({ section })
  }
  const context =
    doc && history
      ? { articleId, doc, history, view, replaceBody, showSources, openExport }
      : undefined
  const exportContent =
    exportView && context && exportScreen
      ? exportScreen({
          ...context,
          section: exportView.section,
          syncStatus,
          onBack: () => {
            setExportView(undefined)
          },
        })
      : undefined

  const handleViewChange = (nextView: EditorView | null) => {
    editorViewRef.current = nextView
    setView(nextView)
    onViewChange?.(nextView)
  }

  const writeMemo = () => {
    flushSync(() => {
      setPanel('memo')
    })
    document.getElementById('new-memo')?.focus()
  }

  const renderPanel = (target: ArticleEditorPanel) => {
    if (target === 'memo')
      return doc ? <MemoPanel doc={doc} {...(view ? { view } : {})} /> : null
    if (target === 'outline') {
      if (!context || (!view && !outlineRenderer)) return null
      const onHeadingSelected = () => {
        if (isMobile) setPanel('body')
      }
      const outlineContext = { ...context, onHeadingSelected }
      return outlineRenderer ? (
        outlineRenderer(outlineContext)
      ) : view ? (
        <ArticleOutline
          doc={context.doc}
          history={context.history}
          onHeadingSelected={onHeadingSelected}
          view={view}
        />
      ) : null
    }
    if (target === 'premise') {
      if (context && premisePanel) return premisePanel(context)
      return doc ? <ArticlePremisePanel doc={doc} /> : null
    }
    if (target === 'sources')
      return typeof sourcesPanel === 'function'
        ? context
          ? sourcesPanel(context)
          : null
        : (sourcesPanel ?? null)
    return (
      <ArticleBody
        empty={isEmpty}
        loading={status?.kind === 'loading'}
        onDecidePremise={() => {
          setPanel('premise')
        }}
        onTitleChange={onTitleChange}
        onWriteMemo={writeMemo}
        title={title}
      >
        {doc && body && history ? (
          <div className="relative">
            <MarkdownEditor
              ariaLabel="本文"
              articleId={articleId}
              // The negative margin offsets the editor's wide start padding, which holds the suggestion markers in the page margin.
              className="min-h-96 -ms-7"
              extensions={extensions}
              history={history}
              onViewChange={handleViewChange}
              ref={editorRef}
              text={body}
            />
            {context ? bodyAccessory?.(context) : null}
          </div>
        ) : null}
      </ArticleBody>
    )
  }

  const availablePanels: Array<{ value: ArticleEditorPanel; label: string }> = [
    { value: 'memo', label: 'メモ' },
    { value: 'outline', label: '構成' },
    { value: 'body', label: '本文' },
    { value: 'premise', label: '前提' },
    ...(sourcesPanel == null
      ? []
      : [{ value: 'sources' as const, label: '資料' }]),
  ]
  const sidePanels = availablePanels.filter(({ value }) => isSidePanel(value))
  const selectedPanel = availablePanels.some(({ value }) => value === panel)
    ? panel
    : 'body'
  const selectedSidePanel = sidePanels.some(({ value }) => value === panel)
    ? panel
    : 'memo'
  const desktopPanelProps = isMobile
    ? {}
    : { hidden: false, inert: false, style: { display: 'block' } }
  const renderTabs = (panels: typeof availablePanels) => (
    <TabsList aria-label="表示する欄">
      {panels.map(({ value, label }) => (
        <TabsTab key={value} value={value}>
          {label}
        </TabsTab>
      ))}
    </TabsList>
  )

  return (
    <>
      {exportContent}
      {/* Hidden instead of unmounted so the editor keeps its undo history and can still take imported text. */}
      <div
        className={`flex min-h-dvh flex-col ${isMobile ? 'h-dvh' : 'lg:h-dvh'}`}
        hidden={exportContent !== undefined}
      >
        <ArticleEditorHeader
          mobile={isMobile}
          mobilePanel={
            selectedPanel === 'body'
              ? undefined
              : {
                  title:
                    availablePanels.find(({ value }) => value === selectedPanel)
                      ?.label ?? '',
                  closeLabel: selectedPanel === 'outline' ? '本文へ' : '閉じる',
                  onClose: () => {
                    setPanel('body')
                  },
                }
          }
          onBack={onBack}
          onExport={
            context && exportScreen
              ? () => {
                  openExport()
                }
              : undefined
          }
          onOpenSettings={onOpenSettings}
          onShowPremise={() => {
            setPanel('premise')
          }}
          onShowSources={
            sourcesPanel == null
              ? undefined
              : () => {
                  setPanel('sources')
                }
          }
          syncStatus={syncStatus}
          title={title}
        />
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 text-sm empty:hidden">
          {status?.kind === 'error' ? (
            <p className="text-destructive" role="alert">
              {status.message}
            </p>
          ) : null}
          {syncError !== undefined ? (
            <p className="text-destructive" role="alert">
              {syncError}
            </p>
          ) : null}
          {requiresAuthentication && onLoginAgain ? (
            <ReauthenticationPrompt onLoginAgain={onLoginAgain} />
          ) : null}
          {context ? articleNotice?.(context) : null}
        </div>

        <Tabs
          onValueChange={(value) => {
            const nextValue: unknown = value
            if (
              typeof nextValue === 'string' &&
              isArticleEditorPanel(nextValue)
            )
              setPanel(nextValue)
          }}
          // The tabs root wraps the columns, so it must not break the page's flex column that lets each column scroll on its own.
          style={{ display: 'contents' }}
          value={isMobile ? selectedPanel : selectedSidePanel}
        >
          <div
            className={`flex flex-col ${isMobile ? 'min-h-0 flex-1 overflow-y-auto' : 'lg:min-h-0 lg:flex-1 lg:flex-row'}`}
          >
            <nav
              aria-label="構成"
              className={
                isMobile
                  ? ''
                  : 'border-b border-border lg:w-66 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0'
              }
            >
              <TabsPanel {...desktopPanelProps} keepMounted value="outline">
                <div className={isMobile ? 'p-4' : 'px-3 py-5'}>
                  {renderPanel('outline')}
                </div>
              </TabsPanel>
            </nav>
            <main
              className={`min-w-0 ${isMobile ? '' : 'lg:flex-1 lg:overflow-y-auto'}`}
            >
              <TabsPanel {...desktopPanelProps} keepMounted value="body">
                <div
                  className={
                    isMobile ? 'px-4.5 py-5' : 'px-8 py-6 lg:pt-10 lg:pb-24'
                  }
                >
                  {renderPanel('body')}
                </div>
              </TabsPanel>
            </main>
            <aside
              className={
                isMobile
                  ? ''
                  : 'flex flex-col border-t border-border lg:w-85 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l'
              }
            >
              {isMobile ? null : renderTabs(sidePanels)}
              <TabsPanel keepMounted value="memo">
                <div className={isMobile ? 'p-4' : 'p-3.5'}>
                  {renderPanel('memo')}
                </div>
              </TabsPanel>
              {/* Unmounting the premise panel discards its unsaved LLM conversation when the writer leaves the tab. */}
              <TabsPanel value="premise">
                <div className={isMobile ? 'p-4' : 'p-3.5'}>
                  {renderPanel('premise')}
                </div>
              </TabsPanel>
              {sourcesPanel == null ? null : (
                <TabsPanel keepMounted value="sources">
                  <div className={isMobile ? 'p-4' : 'p-3.5'}>
                    {renderPanel('sources')}
                  </div>
                </TabsPanel>
              )}
            </aside>
          </div>
        </Tabs>
        {!isMobile ? (
          <EditorStatusBar syncStatus={syncStatus} />
        ) : selectedPanel === 'body' && context && view ? (
          <ArticleEditorMobileToolbar
            history={context.history}
            onRequest={
              onRequest
                ? () => {
                    onRequest(context)
                  }
                : undefined
            }
            onShowMemo={() => {
              setPanel('memo')
            }}
            onShowOutline={() => {
              setPanel('outline')
            }}
            view={view}
          />
        ) : null}
      </div>
    </>
  )
}
