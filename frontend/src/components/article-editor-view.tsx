import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@fohte/ui/tabs'
import { err, ok } from 'neverthrow'
import { useEffect, useMemo, useRef, useState } from 'react'

import { getBody } from '#article/index'
import { ArticleBody } from '#components/article-body'
import {
  getCachedEditorExtensions,
  getMoveHistory,
  useEmptyArticle,
  useSourceCount,
} from '#components/article-editor-document'
import { ArticleEditorHeader } from '#components/article-editor-header'
import { ArticleEditorMobileToolbar } from '#components/article-editor-mobile-toolbar'
import {
  type ArticleEditorPanel,
  type ArticleEditorViewProps,
  EditorNotReadyError,
} from '#components/article-editor-types'
import type { ArticleExportSection } from '#components/article-export-screen'
import { ArticlePremisePanel } from '#components/article-premise-panel'
import { EditorStatusBarContainer } from '#components/editor-status-bar-container'
import type { MarkdownEditorHandle } from '#components/markdown-editor'
import { MarkdownEditor } from '#components/markdown-editor'
import { OutlineModeIntro } from '#components/outline-mode-intro'
import { ReauthenticationPrompt } from '#components/reauthentication-prompt'
import {
  moveConflictExtension,
  suggestionActionsPresentation,
} from '#editor/index'
import { useMobileViewport } from '#hooks/use-mobile-viewport'
import { useOutlineMode } from '#hooks/use-outline-mode'
import { useVisualViewportArea } from '#hooks/use-visual-viewport-area'
import { useWriteMemo } from '#hooks/use-write-memo'
import { MemoPanel } from '#memos/memo-panel'
import { ArticleOutline, createOutlineEditorExtension } from '#outline/index'

export type {
  ArticleEditorContext,
  ArticleEditorIntegrationProps,
  ArticleEditorPanel,
  ArticleEditorViewProps,
  ArticleExportContext,
} from '#components/article-editor-types'

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

const emptyExtensions: Extension[] = []

export function ArticleEditorView({
  articleId,
  title,
  doc,
  status,
  layout = 'responsive',
  initialPanel = 'body',
  initialOutlineMode = false,
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
  syncedAt,
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
  const visibleArea = useVisualViewportArea()
  const mobileVisibleArea = isMobile ? visibleArea : undefined
  const [panel, setPanel] = useState<ArticleEditorPanel>(initialPanel)
  const writeMemo = useWriteMemo(setPanel)
  const { writingOutline, leaveOutlineMode } = useOutlineMode(
    initialOutlineMode,
    !isMobile,
  )
  const [exportView, setExportView] = useState<{
    section: ArticleExportSection | undefined
  }>()
  const isEmpty = useEmptyArticle(doc)
  const sourceCount = useSourceCount(doc)
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
            ...(isMobile ? [suggestionActionsPresentation.of('sheet')] : []),
            ...suppliedExtensions,
          ]
        : [],
    [doc, history, isMobile, suppliedExtensions],
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
      ? {
          articleId,
          doc,
          history,
          view,
          replaceBody,
          showSources,
          sourcesVisible: panel === 'sources',
          openExport,
        }
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

  const renderPanel = (target: ArticleEditorPanel) => {
    if (target === 'memo')
      return doc ? (
        <MemoPanel doc={doc} mobile={isMobile} {...(view ? { view } : {})} />
      ) : null
    if (target === 'outline') {
      if (!context || (!view && !outlineRenderer)) return null
      const onHeadingSelected = () => {
        if (isMobile) setPanel('body')
      }
      const mobile = isMobile && selectedPanel === 'outline'
      const writing = writingOutline
        ? { onOpenBody: leaveOutlineMode }
        : undefined
      const outlineContext = { ...context, mobile, onHeadingSelected, writing }
      return outlineRenderer ? (
        outlineRenderer(outlineContext)
      ) : view ? (
        <ArticleOutline
          doc={context.doc}
          history={context.history}
          mobile={mobile}
          onHeadingSelected={onHeadingSelected}
          view={view}
          writing={writing}
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

  const availablePanels: Array<{
    value: ArticleEditorPanel
    label: string
    count?: number
  }> = [
    { value: 'memo', label: 'メモ' },
    { value: 'outline', label: '構成' },
    { value: 'body', label: '本文' },
    { value: 'premise', label: '前提' },
    ...(sourcesPanel == null
      ? []
      : [{ value: 'sources' as const, label: '資料', count: sourceCount }]),
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
      {panels.map(({ value, label, count = 0 }) => (
        <TabsTab key={value} value={value}>
          {label}
          {count > 0 ? (
            <span className="font-mono text-xs text-muted-foreground">
              {' '}
              {count}
            </span>
          ) : null}
        </TabsTab>
      ))}
    </TabsList>
  )

  return (
    <>
      {exportContent}
      {/* Hidden instead of unmounted so the editor keeps its undo history and can still take imported text. */}
      {/* On mobile the transform makes this the containing block of the fixed suggestion sheet, so the sheet follows it above the keyboard. */}
      <div
        className={`flex min-h-dvh flex-col ${isMobile ? 'h-dvh transform-gpu' : 'lg:h-dvh'}`}
        hidden={exportContent !== undefined}
        style={
          mobileVisibleArea
            ? {
                position: 'fixed',
                insetInline: 0,
                top: mobileVisibleArea.top,
                height: mobileVisibleArea.height,
                minHeight: 0,
              }
            : undefined
        }
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
                  : writingOutline
                    ? 'min-w-0 border-b border-border lg:flex-1 lg:overflow-y-auto lg:border-b-0'
                    : 'border-b border-border lg:w-66 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0'
              }
            >
              <TabsPanel {...desktopPanelProps} keepMounted value="outline">
                <div
                  className={
                    isMobile
                      ? 'p-4'
                      : writingOutline
                        ? 'mx-auto max-w-180 px-8 py-10'
                        : 'px-3 py-5'
                  }
                >
                  {writingOutline ? <OutlineModeIntro title={title} /> : null}
                  {renderPanel('outline')}
                </div>
              </TabsPanel>
            </nav>
            {/* Hidden instead of unmounted because the outline edits the article through this editor. */}
            <main
              className={`min-w-0 ${isMobile ? '' : 'lg:flex-1 lg:overflow-y-auto'}`}
              hidden={writingOutline}
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
                  : // TabsPanel takes no className; stretching it holds the latest memo adoption at the bottom edge.
                    'flex flex-col border-t border-border lg:w-85 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l [&>[role=tabpanel]]:flex [&>[role=tabpanel]]:flex-1 [&>[role=tabpanel]]:flex-col'
              }
            >
              {isMobile ? null : renderTabs(sidePanels)}
              <TabsPanel keepMounted value="memo">
                <div
                  className={`flex flex-1 flex-col ${isMobile ? 'p-4' : 'p-3.5'}`}
                >
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
          <EditorStatusBarContainer
            doc={doc}
            syncStatus={syncStatus}
            syncedAt={syncedAt}
          />
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
