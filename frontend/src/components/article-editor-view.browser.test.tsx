import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Result } from 'neverthrow'
import { ok, okAsync } from 'neverthrow'
import { act, StrictMode, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody, listMemos, moveBlock, setBody } from '#article/index'
import type { ArticleEditorIntegrationProps } from '#components/article-editor-view'
import type { Article, SyncClientApi } from '#lib/sync-client'
import { ArticleWorkspace } from '#pages/article-workspace'

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined

type WorkspaceOptions = ArticleEditorIntegrationProps & {
  error?: string
  requiresAuthentication?: boolean
  syncStatus?: 'saved' | 'unsynced' | 'syncing' | 'synced'
}

function renderWorkspace(
  article: Article,
  articleDoc: Y.Doc,
  {
    error,
    requiresAuthentication = false,
    syncStatus = 'synced',
    ...integrations
  }: WorkspaceOptions = {},
) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  function ArticleWorkspaceHarness() {
    const [articles, setArticles] = useState([article])
    const articlesRef = useRef(articles)
    const [client] = useState<SyncClientApi>(() => ({
      start: () => okAsync(undefined),
      openDocument: () => ok(articleDoc),
      createArticle: () => ok(article),
      updateArticleTitle: (id, title) => {
        setArticles((currentArticles) => {
          const nextArticles = currentArticles.map((currentArticle) =>
            currentArticle.id === id
              ? { ...currentArticle, title }
              : currentArticle,
          )
          articlesRef.current = nextArticles
          return nextArticles
        })
        return ok(undefined)
      },
      listArticles: () => articlesRef.current,
      getStatus: () => syncStatus,
      getError: () => undefined,
      requiresAuthentication: () => requiresAuthentication,
      subscribe: () => () => {},
      destroy: () => {},
    }))

    return (
      <StrictMode>
        <ArticleWorkspace
          articles={articles}
          client={client}
          error={error}
          onCreateArticle={() => undefined}
          onOpenSettings={() => {}}
          ready
          requiresAuthentication={requiresAuthentication}
          statuses={{ [article.id]: syncStatus }}
          {...integrations}
        />
      </StrictMode>
    )
  }

  act(() => {
    root?.render(<ArticleWorkspaceHarness />)
  })
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await page.viewport(1280, 800)
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  doc?.destroy()
  doc = undefined
  vi.unstubAllGlobals()
})

describe('article editor screen', () => {
  it('opens an article, edits and reorders its body, undoes the move, and returns to the list', async () => {
    const article: Article = {
      id: 'article-a',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    const body = getBody(articleDoc)
    const initialBody =
      '# First section\n\nFirst paragraph.\n\n# Second section\n\nSecond paragraph.\n'
    setBody(articleDoc, initialBody)
    renderWorkspace(article, articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const editor = host?.querySelector<HTMLElement>('.cm-content')
    const firstLine = host?.querySelector<HTMLElement>('.cm-line')
    if (!editor || !firstLine)
      throw new Error('The article editor did not open')

    await act(async () => {
      await userEvent.click(firstLine)
      await userEvent.keyboard('{Home}')
      await userEvent.keyboard('{ArrowRight}{ArrowRight}')
      await userEvent.type(editor, 'Updated ')
      await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    })
    const bodyAfterMove = body.toJSON()

    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })

    const editedBody = initialBody.replace(
      '# First section',
      '# Updated First section',
    )
    const bodyAfterUndo = body.toJSON()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Back to articles' }),
      )
    })

    const readScreenOutput = () => ({
      bodyAfterMove,
      bodyAfterUndo,
      listTitle: host?.querySelector('[role="listitem"] button span')
        ?.textContent,
      editorCount: host?.querySelectorAll('.cm-content').length,
    })
    expect(readScreenOutput()).toEqual({
      bodyAfterMove:
        '# Second section\n\nSecond paragraph.\n\n# Updated First section\n\nFirst paragraph.\n',
      bodyAfterUndo: editedBody,
      listTitle: article.title,
      editorCount: 0,
    })
  })

  it('saves a changed title and shows it in the article list', async () => {
    const article: Article = {
      id: 'article-b',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    renderWorkspace(article, articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const renamedTitle = 'A more useful article'
    await act(async () => {
      const titleInput = page.getByRole('textbox', { name: 'Article title' })
      await userEvent.clear(titleInput)
      await userEvent.type(titleInput, renamedTitle)
      await userEvent.click(
        page.getByRole('button', { name: 'Back to articles' }),
      )
    })

    const readScreenOutput = () => ({
      listTitle: host?.querySelector('[role="listitem"] button span')
        ?.textContent,
      editorCount: host?.querySelectorAll('.cm-content').length,
    })
    expect(readScreenOutput()).toEqual({
      listTitle: renamedTitle,
      editorCount: 0,
    })
  })

  it('creates extensions once and reports editor mount and unmount', async () => {
    const article: Article = {
      id: 'article-c',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    let editorExtensionCalls = 0
    const viewChanges: boolean[] = []
    renderWorkspace(article, articleDoc, {
      editorExtensions: () => {
        editorExtensionCalls += 1
        return []
      },
      onViewChange: (view) => {
        viewChanges.push(view !== null)
      },
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Back to articles' }),
      )
    })

    const readIntegrationOutput = () => ({
      editorExtensionCalls,
      viewChanges,
      editorCount: host?.querySelectorAll('.cm-content').length,
    })
    expect(readIntegrationOutput()).toEqual({
      editorExtensionCalls: 1,
      viewChanges: [true, false, true, false],
      editorCount: 0,
    })
  })

  it('keeps one focused editor and its selection through tab and viewport changes', async () => {
    const article: Article = {
      id: 'article-d',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# First section\n\nFirst paragraph.\n')
    let currentView: EditorView | null = null
    renderWorkspace(article, articleDoc, {
      onViewChange: (view) => {
        if (view) currentView = view
      },
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const initialEditor = host?.querySelector('.cm-content')
    const initialView = currentView as EditorView | null
    if (!initialEditor || !initialView)
      throw new Error('The article editor did not mount')
    initialView.dispatch({ selection: EditorSelection.cursor(5) })
    initialView.focus()

    await act(async () => {
      await page.viewport(375, 812)
    })
    const mobileEditor = host?.querySelector('.cm-content')
    const mobileView = currentView as EditorView | null
    const mobileSelection = mobileView?.state.selection.main.head
    const mobileHasFocus = mobileView?.hasFocus

    await act(async () => {
      await page.viewport(1280, 800)
    })
    const finalView = currentView as EditorView | null

    const readResponsiveOutput = () => ({
      sameEditorAfterMobileResize: mobileEditor === initialEditor,
      sameEditorAfterDesktopResize:
        host?.querySelector('.cm-content') === initialEditor,
      sameViewAfterResize:
        mobileView === initialView && finalView === initialView,
      selection: finalView?.state.selection.main.head,
      retainedFocus: finalView?.hasFocus,
      mobileSelection,
      mobileHasFocus,
    })
    expect(readResponsiveOutput()).toEqual({
      sameEditorAfterMobileResize: true,
      sameEditorAfterDesktopResize: true,
      sameViewAfterResize: true,
      selection: 5,
      retainedFocus: true,
      mobileSelection: 5,
      mobileHasFocus: true,
    })
  })

  it('moves and undoes a section from the desktop outline', async () => {
    await page.viewport(1280, 800)
    const article: Article = {
      id: 'article-e',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    const initialBody =
      '# First section\n\nFirst paragraph.\n\n# Second section\n\nSecond paragraph.\n'
    setBody(articleDoc, initialBody)
    renderWorkspace(article, articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const outline = host?.querySelector('[aria-label="Article outline"]')
    const moveButton = outline?.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Second section"]',
    )
    if (!outline || !moveButton)
      throw new Error('The desktop article outline did not render')
    await act(async () => {
      await userEvent.click(moveButton)
      await userEvent.click(page.getByRole('menuitem', { name: 'Move up' }))
    })
    const bodyAfterOutlineMove = getBody(articleDoc).toJSON()
    const editor = host?.querySelector<HTMLElement>('.cm-content')
    if (!editor) throw new Error('The article editor did not render')
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    await act(async () => {
      await userEvent.click(editor)
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })

    const readOutlineHistoryOutput = () => ({
      outlineRendered: outline.isConnected,
      bodyAfterOutlineMove,
      bodyAfterUndo: getBody(articleDoc).toJSON(),
    })
    expect(readOutlineHistoryOutput()).toEqual({
      outlineRendered: true,
      bodyAfterOutlineMove:
        '# Second section\n\nSecond paragraph.\n\n# First section\n\nFirst paragraph.\n',
      bodyAfterUndo: initialBody,
    })
  })

  it('repairs an offline deletion when a remote move reaches the open editor', async () => {
    const article: Article = {
      id: 'article-h',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const baseline = new Y.Doc()
    baseline.clientID = 71
    const initialBody = '## Cedar\na1\n## Fjord\nmaple maple\n## Vista\nz9\n'
    setBody(baseline, initialBody)

    const offlineEditor = new Y.Doc()
    offlineEditor.clientID = 73
    Y.applyUpdate(offlineEditor, Y.encodeStateAsUpdate(baseline))
    const offlineBody = getBody(offlineEditor)
    offlineBody.insert(offlineBody.toJSON().indexOf('maple') + 5, 'xy')
    offlineBody.delete(offlineBody.toJSON().lastIndexOf('ple'), 3)

    const mover = new Y.Doc()
    mover.clientID = 72
    Y.applyUpdate(mover, Y.encodeStateAsUpdate(baseline))
    moveBlock(mover, {
      from: initialBody.indexOf('## Fjord\n'),
      destination: initialBody.length,
    })._unsafeUnwrap()
    const moveUpdate = Y.encodeStateAsUpdate(
      mover,
      Y.encodeStateVector(baseline),
    )
    doc = offlineEditor
    renderWorkspace(article, offlineEditor)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    act(() => {
      Y.applyUpdate(offlineEditor, moveUpdate, 'remote-move')
    })

    const readMoveRepairOutput = () => ({
      body: getBody(offlineEditor).toJSON(),
      acknowledgements: offlineEditor.getMap('move-acks').size,
    })
    expect(readMoveRepairOutput()).toEqual({
      body: '## Cedar\na1\nxy## Vista\nz9\n\n## Fjord\nmaple ma\n',
      acknowledgements: 1,
    })
    baseline.destroy()
    mover.destroy()
  })

  it('shows mobile memo and outline tabs and returns to the article after heading selection', async () => {
    await page.viewport(375, 812)
    const article: Article = {
      id: 'article-f',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# First section\n\nFirst paragraph.\n')
    renderWorkspace(article, articleDoc, { sourcesPanel: null })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const editor = host?.querySelector('.cm-content')
    await act(async () => {
      await userEvent.click(page.getByRole('tab', { name: 'Memo' }))
    })
    const memoPanelVisible = page.getByRole('textbox', { name: '新しいメモ' })
    await act(async () => {
      await userEvent.type(memoPanelVisible, 'A useful note')
      await userEvent.click(page.getByRole('button', { name: '追加' }))
      await userEvent.click(page.getByRole('tab', { name: 'Outline' }))
    })
    const heading = page.getByRole('option', { name: /First section/u })
    await act(async () => {
      await userEvent.click(heading)
    })
    const articleVisible =
      (host?.querySelector('.cm-content')?.getBoundingClientRect().width ?? 0) >
      0

    const readMobileTabsOutput = () => ({
      editorRetained: host?.querySelector('.cm-content') === editor,
      memoText: listMemos(articleDoc).length,
      selectedTab: host
        ?.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent.trim(),
      articleVisible,
      sourcesTabCount: host?.querySelectorAll('[role="tab"]').length,
    })
    expect(readMobileTabsOutput()).toEqual({
      editorRetained: true,
      memoText: 1,
      selectedTab: 'Article',
      articleVisible: true,
      sourcesTabCount: 3,
    })
  })

  it('passes article context to integrations and reports unavailable editors', async () => {
    const article: Article = {
      id: 'article-g',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    let capturedArticleId: string | undefined
    let liveReplacement: 'ok' | 'error' | undefined
    let staleReplaceBody: ((value: string) => Result<void, Error>) | undefined
    renderWorkspace(article, articleDoc, {
      bodyAccessory: () => (
        <div data-testid="body-accessory">Draft request</div>
      ),
      headerActions: ({ articleId, replaceBody }) => {
        capturedArticleId = articleId
        staleReplaceBody = replaceBody
        return (
          <button
            onClick={() => {
              liveReplacement = replaceBody('# Exported body\n').match(
                () => 'ok',
                () => 'error',
              )
            }}
            type="button"
          >
            Replace body
          </button>
        )
      },
      outlineAccessory: () => <div>Outline accessory</div>,
      premiseAccessory: () => <div>Premise accessory</div>,
      sourcesPanel: <div>Source material</div>,
      requiresAuthentication: true,
      error: 'Sync needs attention.',
      syncStatus: 'unsynced',
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const reader = page.getByRole('textbox', { name: 'Reader' })
    await act(async () => {
      await userEvent.clear(reader)
      await userEvent.type(reader, 'Designers')
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'Replace body' }))
    })
    const renderedIntegrations = {
      bodyAccessory: host?.querySelector('[data-testid="body-accessory"]')
        ?.textContent,
      relativeBodyPanel: getComputedStyle(
        host?.querySelector('[data-testid="body-accessory"]')?.parentElement ??
          document.body,
      ).position,
      outlineAccessory: host?.textContent.includes('Outline accessory'),
      premiseAccessory: host?.textContent.includes('Premise accessory'),
      sourceMaterial: host?.textContent.includes('Source material'),
      syncError: host?.querySelector('[role="alert"]')?.textContent,
      reauthentication: host?.textContent.includes('Log in again'),
      syncState: host?.querySelector('[data-state="unsynced"]')?.textContent,
      savedPremise: articleDoc.getMap('premise').get('audience'),
    }
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Back to articles' }),
      )
    })
    const staleReplacement = staleReplaceBody?.('# Stale replacement\n')
    const staleReplacementResult = staleReplacement?.match(
      () => 'ready',
      (error) => error.name,
    )

    const readInjectedOutput = () => ({
      articleId: capturedArticleId,
      ...renderedIntegrations,
      liveReplacement,
      staleReplacementResult,
      body: getBody(articleDoc).toJSON(),
    })
    expect(readInjectedOutput()).toEqual({
      articleId: article.id,
      bodyAccessory: 'Draft request',
      relativeBodyPanel: 'relative',
      outlineAccessory: true,
      premiseAccessory: true,
      sourceMaterial: true,
      syncError: 'Sync needs attention.',
      reauthentication: true,
      syncState: '未同期',
      savedPremise: 'Designers',
      liveReplacement: 'ok',
      staleReplacementResult: 'EditorNotReadyError',
      body: '# Exported body\n',
    })
  })
})
