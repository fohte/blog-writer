import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Panel } from '@fohte/ui/panel'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@fohte/ui/tabs'
import { Textarea } from '@fohte/ui/textarea'
import { err, ok, type Result } from 'neverthrow'
import type { ReactNode } from 'react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import * as Y from 'yjs'

import { getBody, getPremise, setPremise } from '#article/index'
import type { PremiseField } from '#article/types'
import type { MarkdownEditorHandle } from '#components/markdown-editor'
import { MarkdownEditor } from '#components/markdown-editor'
import { ReauthenticationPrompt } from '#components/reauthentication-prompt'
import { SyncStatus } from '#components/sync-status'
import { moveConflictExtension } from '#editor/index'
import type { SyncState } from '#lib/sync-client'
import { MemoPanel } from '#memos/memo-panel'
import {
  ArticleOutline,
  createMoveHistory,
  createOutlineEditorExtension,
  type MoveHistory,
} from '#outline/index'

export type ArticleEditorPanel = 'memo' | 'outline' | 'body' | 'sources'
export type ArticleEditorLayout = 'responsive' | 'mobile' | 'desktop'
export type ArticleEditorContext = {
  articleId: string
  doc: Y.Doc
  history: MoveHistory
  view: EditorView | null
  replaceBody: (value: string) => Result<void, EditorNotReadyError>
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
    value === 'sources'
  )
}

export interface ArticleEditorViewProps {
  articleId: string
  title: string
  doc?: Y.Doc | undefined
  status?: { kind: 'loading' } | { kind: 'error'; message: string } | undefined
  layout?: ArticleEditorLayout
  initialMobilePanel?: ArticleEditorPanel
  initialPremiseOpen?: boolean
  /** Keeps extension instances stable by calling the factory once per article document. */
  editorExtensions?:
    ((context: { doc: Y.Doc; history: MoveHistory }) => Extension[]) | undefined
  bodyAccessory?: ((context: ArticleEditorContext) => ReactNode) | undefined
  outlineRenderer?:
    ((context: ArticleOutlineRenderContext) => ReactNode) | undefined
  premiseAccessory?: ((context: ArticleEditorContext) => ReactNode) | undefined
  headerActions?: ((context: ArticleEditorContext) => ReactNode) | undefined
  sourcesPanel?:
    ReactNode | ((context: ArticleEditorContext) => ReactNode) | undefined
  onViewChange?: ((view: EditorView | null) => void) | undefined
  syncStatus?: SyncState | undefined
  syncError?: string | undefined
  requiresAuthentication?: boolean | undefined
  onLoginAgain?: (() => void) | undefined
  onTitleChange: (title: string) => void
  onBack: () => void
}

export type ArticleEditorIntegrationProps = Pick<
  ArticleEditorViewProps,
  | 'bodyAccessory'
  | 'editorExtensions'
  | 'headerActions'
  | 'onViewChange'
  | 'outlineRenderer'
  | 'premiseAccessory'
  | 'sourcesPanel'
>

const premiseFields: Array<{ field: PremiseField; label: string }> = [
  { field: 'audience', label: 'Reader' },
  { field: 'purpose', label: 'Purpose' },
  { field: 'claim', label: 'Claim' },
]

const emptyExtensions: Extension[] = []
// Extension instances may hold article state and must survive StrictMode replays.
const moveHistoriesByDocument = new WeakMap<Y.Doc, MoveHistory>()
const extensionsByDocument = new WeakMap<Y.Doc, Extension[]>()

function getMoveHistory(doc: Y.Doc) {
  const existing = moveHistoriesByDocument.get(doc)
  if (existing) return existing
  const history = createMoveHistory(doc)
  moveHistoriesByDocument.set(doc, history)
  return history
}

function getCachedEditorExtensions(
  doc: Y.Doc,
  history: MoveHistory,
  factory: (context: { doc: Y.Doc; history: MoveHistory }) => Extension[],
) {
  const existing = extensionsByDocument.get(doc)
  if (existing) return existing
  const extensions = factory({ doc, history })
  extensionsByDocument.set(doc, extensions)
  return extensions
}

function subscribeToViewportChange(listener: () => void) {
  const media = window.matchMedia('(max-width: 767px)')
  media.addEventListener('change', listener)
  return () => {
    media.removeEventListener('change', listener)
  }
}

function getMobileViewport() {
  return window.matchMedia('(max-width: 767px)').matches
}

function useIsMobile(layout: ArticleEditorLayout) {
  const viewportIsMobile = useSyncExternalStore(
    subscribeToViewportChange,
    getMobileViewport,
    () => false,
  )
  return layout === 'mobile' || (layout === 'responsive' && viewportIsMobile)
}

export function ArticleEditorView({
  articleId,
  title,
  doc,
  status,
  layout = 'responsive',
  initialMobilePanel = 'body',
  initialPremiseOpen = false,
  editorExtensions,
  bodyAccessory,
  outlineRenderer,
  premiseAccessory,
  headerActions,
  sourcesPanel,
  onViewChange,
  syncStatus,
  syncError,
  requiresAuthentication = false,
  onLoginAgain,
  onTitleChange,
  onBack,
}: ArticleEditorViewProps) {
  const isMobile = useIsMobile(layout)
  const [mobilePanel, setMobilePanel] =
    useState<ArticleEditorPanel>(initialMobilePanel)
  const [premise, setPremiseValue] = useState(() =>
    doc ? getPremise(doc) : { audience: null, purpose: null, claim: null },
  )
  const [premiseOpen, setPremiseOpen] = useState(initialPremiseOpen)
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
    if (!doc) return
    const premiseMap = doc.getMap('premise')
    const refresh = () => {
      setPremiseValue(getPremise(doc))
    }
    premiseMap.observe(refresh)
    refresh()
    return () => {
      premiseMap.unobserve(refresh)
    }
  }, [doc])

  useEffect(() => {
    return () => {
      history?.destroy()
    }
  }, [history])

  const setPremiseField = (field: PremiseField, value: string) => {
    if (!doc) return
    setPremise(doc, field, value.length > 0 ? value : null)
    setPremiseValue(getPremise(doc))
  }

  const replaceBody = (value: string) => {
    if (!editorViewRef.current || !editorRef.current)
      return err(new EditorNotReadyError())
    editorRef.current.replaceBody(value)
    return ok(undefined)
  }

  const context =
    doc && history ? { articleId, doc, history, view, replaceBody } : undefined

  const handleViewChange = (nextView: EditorView | null) => {
    editorViewRef.current = nextView
    setView(nextView)
    onViewChange?.(nextView)
  }

  const renderPanel = (panel: ArticleEditorPanel) => {
    if (panel === 'memo')
      return doc ? <MemoPanel doc={doc} {...(view ? { view } : {})} /> : null
    if (panel === 'outline') {
      if (!context || (!view && !outlineRenderer)) return null
      const onHeadingSelected = () => {
        if (isMobile) setMobilePanel('body')
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
    if (panel === 'sources')
      return typeof sourcesPanel === 'function'
        ? context
          ? sourcesPanel(context)
          : null
        : (sourcesPanel ?? null)
    return doc && body && history ? (
      <Panel className="min-h-96 overflow-auto rounded-lg p-4">
        <div className="relative">
          <MarkdownEditor
            ariaLabel="Article body"
            articleId={articleId}
            className="min-h-96"
            extensions={extensions}
            history={history}
            onViewChange={handleViewChange}
            ref={editorRef}
            text={body}
          />
          {context ? bodyAccessory?.(context) : null}
        </div>
      </Panel>
    ) : null
  }

  const availablePanels: Array<{ value: ArticleEditorPanel; label: string }> = [
    { value: 'memo', label: 'Memo' },
    { value: 'outline', label: 'Outline' },
    { value: 'body', label: 'Article' },
    ...(sourcesPanel == null
      ? []
      : [{ value: 'sources' as const, label: 'Sources' }]),
  ]
  const selectedMobilePanel = availablePanels.some(
    ({ value }) => value === mobilePanel,
  )
    ? mobilePanel
    : 'body'
  const desktopPanelProps = isMobile
    ? {}
    : { hidden: false, inert: false, style: { display: 'block' } }
  const layoutClasses = {
    pagePadding: isMobile ? 'px-4' : 'px-4 sm:px-6',
    premiseColumns: isMobile ? '' : 'sm:grid-cols-3',
    premiseAccessorySpan: isMobile ? '' : 'sm:col-span-3',
    workspaceColumns: isMobile ? '' : 'lg:grid-cols-3',
    sidebar: isMobile
      ? ''
      : 'lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:col-span-1',
    panelSpacing: isMobile ? 'pt-4' : 'pt-4 lg:pt-0',
    bodyColumns: isMobile ? '' : 'lg:col-span-2',
  }

  return (
    <main
      className={`mx-auto flex min-h-screen max-w-7xl flex-col gap-6 py-6 ${layoutClasses.pagePadding}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Button onClick={onBack} type="button" variant="outline">
            Back to articles
          </Button>
          <div className="flex items-center gap-2">
            {context ? headerActions?.(context) : null}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <label
            className="flex flex-col gap-2 text-sm font-medium"
            htmlFor="article-title"
          >
            Article title
            <Input
              id="article-title"
              onChange={(event) => {
                onTitleChange(event.currentTarget.value)
              }}
              value={title}
            />
          </label>
          {doc ? (
            <section
              aria-label="Article premise"
              className="flex flex-col gap-3"
            >
              <button
                aria-controls="article-premise-fields"
                aria-expanded={premiseOpen}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-sm"
                onClick={() => {
                  setPremiseOpen((open) => !open)
                }}
                type="button"
              >
                <span className="min-w-0 truncate">
                  Premise: Reader {premise.audience ?? 'unset'} · Purpose{' '}
                  {premise.purpose ?? 'unset'} · Claim{' '}
                  {premise.claim ?? 'unset'}
                </span>
                <span aria-hidden="true">{premiseOpen ? 'Hide' : 'Edit'}</span>
              </button>
              {premiseOpen ? (
                <div
                  className={`grid gap-3 ${layoutClasses.premiseColumns}`}
                  id="article-premise-fields"
                >
                  {premiseFields.map(({ field, label }) => (
                    <label
                      className="flex flex-col gap-2 text-sm font-medium"
                      htmlFor={`premise-${field}`}
                      key={field}
                    >
                      {label}
                      <Textarea
                        id={`premise-${field}`}
                        onChange={(event) => {
                          setPremiseField(field, event.currentTarget.value)
                        }}
                        placeholder={`${label} for this article`}
                        value={premise[field] ?? ''}
                      />
                    </label>
                  ))}
                  {context ? (
                    <div className={layoutClasses.premiseAccessorySpan}>
                      {premiseAccessory?.(context)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </header>

      {status ? (
        <p
          aria-live="polite"
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.kind === 'loading' ? 'Opening article…' : status.message}
        </p>
      ) : null}
      {syncError !== undefined ? <p role="alert">{syncError}</p> : null}
      {requiresAuthentication && onLoginAgain ? (
        <ReauthenticationPrompt onLoginAgain={onLoginAgain} />
      ) : null}
      {syncStatus ? <SyncStatus state={syncStatus} /> : null}

      {doc ? (
        <Tabs
          onValueChange={(value) => {
            const nextValue: unknown = value
            if (
              typeof nextValue === 'string' &&
              isArticleEditorPanel(nextValue)
            ) {
              setMobilePanel(nextValue)
            }
          }}
          value={selectedMobilePanel}
        >
          <div className={isMobile ? 'block' : 'hidden'}>
            <TabsList aria-label="Article sections">
              {availablePanels.map(({ value, label }) => (
                <TabsTab key={value} value={value}>
                  {label}
                </TabsTab>
              ))}
            </TabsList>
          </div>
          <div
            className={`grid min-w-0 gap-6 ${layoutClasses.workspaceColumns}`}
          >
            <aside
              className={`flex min-w-0 flex-col gap-6 ${layoutClasses.sidebar}`}
            >
              {(['outline', 'memo', 'sources'] as const).map((value) =>
                availablePanels.some((panel) => panel.value === value) ? (
                  <TabsPanel
                    {...desktopPanelProps}
                    key={value}
                    keepMounted
                    value={value}
                  >
                    <div className={layoutClasses.panelSpacing}>
                      {renderPanel(value)}
                    </div>
                  </TabsPanel>
                ) : null,
              )}
            </aside>
            <section
              aria-label="Article body"
              className={`min-w-0 ${layoutClasses.bodyColumns}`}
            >
              <TabsPanel {...desktopPanelProps} keepMounted value="body">
                <div className={layoutClasses.panelSpacing}>
                  {renderPanel('body')}
                </div>
              </TabsPanel>
            </section>
          </div>
        </Tabs>
      ) : null}
    </main>
  )
}
