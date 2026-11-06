import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Panel } from '@fohte/ui/panel'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@fohte/ui/tabs'
import { Textarea } from '@fohte/ui/textarea'
import type { ReactNode } from 'react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import * as Y from 'yjs'

import { getBody, getPremise, setBody, setPremise } from '#article/index'
import type { PremiseField } from '#article/types'
import type { MarkdownEditorHandle } from '#components/markdown-editor'
import { MarkdownEditor } from '#components/markdown-editor'
import { moveConflictExtension } from '#editor/index'
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
  doc: Y.Doc
  history: MoveHistory
  view: EditorView | null
  replaceBody: (value: string) => void
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
  title: string
  doc?: Y.Doc | undefined
  status?: { kind: 'loading' } | { kind: 'error'; message: string } | undefined
  layout?: ArticleEditorLayout
  initialMobilePanel?: ArticleEditorPanel
  editorExtensions?:
    ((context: { doc: Y.Doc; history: MoveHistory }) => Extension[]) | undefined
  bodyAccessory?: ((context: ArticleEditorContext) => ReactNode) | undefined
  outlineAccessory?: ((context: ArticleEditorContext) => ReactNode) | undefined
  premiseAccessory?: ((context: ArticleEditorContext) => ReactNode) | undefined
  headerActions?: ((context: ArticleEditorContext) => ReactNode) | undefined
  sourcesPanel?: ReactNode | undefined
  onViewChange?: ((view: EditorView | null) => void) | undefined
  onTitleChange: (title: string) => void
  onBack: () => void
}

const premiseFields: Array<{ field: PremiseField; label: string }> = [
  { field: 'audience', label: 'Reader' },
  { field: 'purpose', label: 'Purpose' },
  { field: 'claim', label: 'Claim' },
]

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
  title,
  doc,
  status,
  layout = 'responsive',
  initialMobilePanel = 'body',
  editorExtensions,
  bodyAccessory,
  outlineAccessory,
  premiseAccessory,
  headerActions,
  sourcesPanel,
  onViewChange,
  onTitleChange,
  onBack,
}: ArticleEditorViewProps) {
  const isMobile = useIsMobile(layout)
  const [mobilePanel, setMobilePanel] =
    useState<ArticleEditorPanel>(initialMobilePanel)
  const [premise, setPremiseValue] = useState(() =>
    doc ? getPremise(doc) : { audience: null, purpose: null, claim: null },
  )
  const history = useMemo(
    () => (doc ? createMoveHistory(doc) : undefined),
    [doc],
  )
  const body = doc ? getBody(doc) : undefined
  const [view, setView] = useState<EditorView | null>(null)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const editorExtensionsRef = useRef(editorExtensions)
  editorExtensionsRef.current = editorExtensions
  const extensions = useMemo(
    () =>
      doc && history
        ? [
            moveConflictExtension(doc),
            createOutlineEditorExtension(history),
            ...(editorExtensionsRef.current?.({ doc, history }) ?? []),
          ]
        : [],
    [doc, history],
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
    if (!doc) return
    if (editorRef.current) editorRef.current.replaceBody(value)
    else setBody(doc, value)
  }

  const context =
    doc && history ? { doc, history, view, replaceBody } : undefined

  const handleViewChange = (nextView: EditorView | null) => {
    setView(nextView)
    onViewChange?.(nextView)
  }

  const renderPanel = (panel: ArticleEditorPanel) => {
    if (panel === 'memo') return doc ? <MemoPanel doc={doc} /> : null
    if (panel === 'outline') {
      if (!context) return null
      return (
        <div className="flex flex-col gap-4">
          {outlineAccessory?.(context)}
          {view ? (
            <ArticleOutline
              doc={context.doc}
              history={context.history}
              view={view}
            />
          ) : null}
        </div>
      )
    }
    if (panel === 'sources') return sourcesPanel ?? null
    return doc && body && history ? (
      <Panel className="min-h-96 overflow-auto rounded-lg p-4">
        <MarkdownEditor
          ariaLabel="Article body"
          className="min-h-96"
          extensions={extensions}
          history={history}
          onViewChange={handleViewChange}
          ref={editorRef}
          text={body}
        />
        {context ? bodyAccessory?.(context) : null}
      </Panel>
    ) : null
  }

  const availablePanels: Array<{ value: ArticleEditorPanel; label: string }> = [
    { value: 'memo', label: 'Memo' },
    { value: 'outline', label: 'Outline' },
    { value: 'body', label: 'Article' },
    ...(sourcesPanel === undefined
      ? []
      : [{ value: 'sources' as const, label: 'Sources' }]),
  ]

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
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
              className="grid gap-3 sm:grid-cols-3"
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
              {context ? premiseAccessory?.(context) : null}
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

      {doc && isMobile ? (
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
          value={mobilePanel}
        >
          <TabsList aria-label="Article sections">
            {availablePanels.map(({ value, label }) => (
              <TabsTab key={value} value={value}>
                {label}
              </TabsTab>
            ))}
          </TabsList>
          {availablePanels.map(({ value }) => (
            <TabsPanel key={value} keepMounted={value === 'body'} value={value}>
              <div className="pt-4">
                {value === 'body' || mobilePanel === value
                  ? renderPanel(value)
                  : null}
              </div>
            </TabsPanel>
          ))}
        </Tabs>
      ) : doc ? (
        <div className="grid min-w-0 gap-6 lg:grid-cols-3">
          <aside className="flex min-w-0 flex-col gap-6 lg:col-span-1">
            {renderPanel('outline')}
            {renderPanel('memo')}
            {sourcesPanel}
          </aside>
          <section aria-label="Article body" className="min-w-0 lg:col-span-2">
            {renderPanel('body')}
          </section>
        </div>
      ) : null}
    </main>
  )
}
