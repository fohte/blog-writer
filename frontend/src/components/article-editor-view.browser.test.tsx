import '#index.css'

import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Result } from 'neverthrow'
import { ok, okAsync } from 'neverthrow'
import { act, StrictMode, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { addMemo, getBody, listMemos, moveBlock, setBody } from '#article/index'
import type { ArticleEditorIntegrationProps } from '#components/article-editor-view'
import type { Article, SyncClientApi } from '#lib/sync-client'
import { ArticleEditorPage } from '#pages/article-editor-page'
import { ArticleWorkspace } from '#pages/article-workspace'

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined
let additionalDocs: Y.Doc[] = []

type WorkspaceOptions = ArticleEditorIntegrationProps & {
  error?: string
  requiresAuthentication?: boolean
  syncStatus?: 'saved' | 'unsynced' | 'syncing' | 'synced'
  syncedAt?: number
  onOpenSettings?: () => void
}

function renderWorkspace(
  article: Article,
  articleDoc: Y.Doc,
  {
    error,
    requiresAuthentication = false,
    syncStatus = 'synced',
    syncedAt,
    onOpenSettings = () => {},
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
      updateArticleExportSettings: () => ok(undefined),
      listArticles: () => articlesRef.current,
      getStatus: () => syncStatus,
      getSyncedAt: () => syncedAt,
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
          onOpenSettings={onOpenSettings}
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

function modifierKey() {
  return navigator.platform.includes('Mac') ? 'Meta' : 'Control'
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
  for (const additionalDoc of additionalDocs) additionalDoc.destroy()
  additionalDocs = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('article editor screen', () => {
  it('shows the last sync time, the LLM route and a live character count in the status bar', async () => {
    const article: Article = {
      id: 'article-status-bar',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, 'ab\ncd')
    renderWorkspace(article, articleDoc, {
      syncedAt: new Date(2026, 0, 15, 2, 14).getTime(),
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const readStatusItems = () => {
      const items = Array.from(
        host?.querySelector('footer')?.children ?? [],
        (item) => item.textContent,
      )
      return items.slice(0, items.indexOf(''))
    }

    await vi.waitFor(() => {
      expect(readStatusItems()).toEqual([
        '端末に保存済み · 同期済み 02:14',
        'LLM サーバー',
        '4 字',
      ])
    })
    act(() => {
      setBody(articleDoc, 'abcdefg')
    })

    expect(readStatusItems()).toEqual([
      '端末に保存済み · 同期済み 02:14',
      'LLM サーバー',
      '7 字',
    ])
  })

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

    const modifier = modifierKey()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })

    const editedBody = initialBody.replace(
      '# First section',
      '# Updated First section',
    )
    const bodyAfterUndo = body.toJSON()
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'blog-writer' }))
    })

    const readScreenOutput = () => ({
      bodyAfterMove,
      bodyAfterUndo,
      listTitle: host?.querySelector('li button')?.textContent,
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
      const titleInput = page.getByRole('textbox', { name: 'タイトル' })
      await userEvent.clear(titleInput)
      await userEvent.type(titleInput, renamedTitle)
      await userEvent.click(page.getByRole('button', { name: 'blog-writer' }))
    })

    const readScreenOutput = () => ({
      listTitle: host?.querySelector('li button')?.textContent,
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
      await userEvent.click(page.getByRole('button', { name: 'blog-writer' }))
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
    setBody(
      articleDoc,
      `# First section

First paragraph.
`,
    )
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

  it('shows the outline, the article, and the selected side tab on desktop', async () => {
    await page.viewport(1280, 800)
    const article: Article = {
      id: 'article-desktop-panels',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# First section\n\nFirst paragraph.\n')
    renderWorkspace(article, articleDoc, {
      sourcesPanel: (
        <section aria-label="Reference sources">Reference material</section>
      ),
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })

    const widthOf = (selector: string) =>
      host?.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
        .width ?? 0
    const readPanels = () => ({
      outlineVisible: widthOf('[aria-label="Article outline"]') > 0,
      memoVisible: widthOf('section[aria-label="メモ"]') > 0,
      sourcesVisible: widthOf('[aria-label="Reference sources"]') > 0,
      bodyVisible: widthOf('.cm-content') > 0,
      tabs: [...(host?.querySelectorAll('[role="tab"]') ?? [])].map(
        (tab) => tab.textContent,
      ),
    })
    const initialPanels = readPanels()
    await act(async () => {
      await userEvent.click(page.getByRole('tab', { name: '資料' }))
    })
    // Base UI hides the previous panel on a later animation frame.
    await vi.waitFor(() => {
      if (widthOf('section[aria-label="メモ"]') > 0)
        throw new Error('The memo panel was not hidden')
    })

    const readDesktopPanelOutput = () => ({
      initialPanels,
      panelsWithSources: readPanels(),
    })
    expect(readDesktopPanelOutput()).toEqual({
      initialPanels: {
        outlineVisible: true,
        memoVisible: true,
        sourcesVisible: false,
        bodyVisible: true,
        tabs: ['メモ', '前提', '資料'],
      },
      panelsWithSources: {
        outlineVisible: true,
        memoVisible: false,
        sourcesVisible: true,
        bodyVisible: true,
        tabs: ['メモ', '前提', '資料'],
      },
    })
  })

  it('keeps a long desktop outline within a scrollable left column', async () => {
    await page.viewport(1280, 800)
    const article: Article = {
      id: 'article-long-outline',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(
      articleDoc,
      Array.from(
        { length: 30 },
        (_, index) => `## Section ${String(index + 1)}

Details.`,
      ).join(`

`),
    )
    renderWorkspace(article, articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })

    const sidebar = host?.querySelector<HTMLElement>('nav[aria-label="構成"]')
    const readLongOutlineOutput = () => ({
      overflowY: sidebar ? getComputedStyle(sidebar).overflowY : null,
      contentExceedsVisibleHeight:
        sidebar !== null && sidebar !== undefined
          ? sidebar.scrollHeight > sidebar.clientHeight
          : false,
      bodyVisible:
        (host?.querySelector('.cm-content')?.getBoundingClientRect().width ??
          0) > 0,
    })
    expect(readLongOutlineOutput()).toEqual({
      overflowY: 'auto',
      contentExceedsVisibleHeight: true,
      bodyVisible: true,
    })
  })

  it('keeps a long tablet outline above the article body', async () => {
    await page.viewport(900, 800)
    const article: Article = {
      id: 'article-tablet-outline',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(
      articleDoc,
      Array.from(
        { length: 30 },
        (_, index) => `## Section ${String(index + 1)}

Details.`,
      ).join(`

`),
    )
    renderWorkspace(article, articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })

    const sidebar = host?.querySelector<HTMLElement>('nav[aria-label="構成"]')
    const body = host?.querySelector<HTMLElement>('main')
    const readTabletLayoutOutput = () => ({
      overflowY: sidebar ? getComputedStyle(sidebar).overflowY : null,
      bodyStartsAfterSidebarContent:
        sidebar !== null &&
        sidebar !== undefined &&
        body !== null &&
        body !== undefined
          ? body.getBoundingClientRect().top >=
            sidebar.getBoundingClientRect().top + sidebar.scrollHeight
          : false,
    })
    expect(readTabletLayoutOutput()).toEqual({
      overflowY: 'visible',
      bodyStartsAfterSidebarContent: true,
    })
  })

  it('shows the article panel after widening from the mobile outline screen', async () => {
    await page.viewport(375, 812)
    const article: Article = {
      id: 'article-mobile-resize',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(
      articleDoc,
      `# First section

First paragraph.
`,
    )
    renderWorkspace(article, articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    await act(async () => {
      await userEvent.click(
        page
          .getByRole('toolbar', { name: '入力補助' })
          .getByRole('button', { name: '構成' }),
      )
    })
    const editor = host?.querySelector('.cm-content')
    const readTabs = () =>
      [...(host?.querySelectorAll('[role="tab"]') ?? [])].map(
        (tab) => tab.textContent,
      )
    const mobileScreenTitle = host?.querySelector('header h2')?.textContent

    await act(async () => {
      await page.viewport(1280, 800)
    })
    const desktopBodyVisible =
      (host?.querySelector('.cm-content')?.getBoundingClientRect().width ?? 0) >
      0
    const desktopOutlineVisible =
      (host
        ?.querySelector('[aria-label="Article outline"]')
        ?.getBoundingClientRect().width ?? 0) > 0
    const desktopTabs = readTabs()

    await act(async () => {
      await page.viewport(375, 812)
    })
    const readResizeOutput = () => ({
      mobileScreenTitle,
      desktopBodyVisible,
      desktopOutlineVisible,
      desktopTabs,
      mobileTabs: readTabs(),
      editorRetained: host?.querySelector('.cm-content') === editor,
    })
    expect(readResizeOutput()).toEqual({
      mobileScreenTitle: '構成',
      desktopBodyVisible: true,
      desktopOutlineVisible: true,
      desktopTabs: ['メモ', '前提'],
      mobileTabs: [],
      editorRetained: true,
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
    const modifier = modifierKey()
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

  it('opens mobile memo and outline screens from the toolbar and returns to the article after heading selection', async () => {
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
    const toolbarButton = (name: string) =>
      page
        .getByRole('toolbar', { name: '入力補助' })
        .getByRole('button', { name })
    const readScreen = () => ({
      title: host?.querySelector('header h2')?.textContent ?? 'article',
      toolbar: host?.querySelector('[role="toolbar"]') !== null,
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const editor = host?.querySelector('.cm-content')
    await act(async () => {
      await userEvent.click(toolbarButton('メモ'))
    })
    const memoScreen = readScreen()
    await act(async () => {
      await userEvent.type(
        page.getByRole('textbox', { name: 'メモを足す' }),
        'A useful note',
      )
      await userEvent.keyboard('{Enter}')
      await userEvent.click(page.getByRole('button', { name: '閉じる' }))
    })
    const screenAfterClose = readScreen()
    await act(async () => {
      await userEvent.click(toolbarButton('構成'))
    })
    const outlineScreen = readScreen()
    await act(async () => {
      await userEvent.click(
        page.getByRole('option', { name: /First section/u }),
      )
    })
    const articleVisible =
      (host?.querySelector('.cm-content')?.getBoundingClientRect().width ?? 0) >
      0
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'その他' }))
    })

    const readMobileScreensOutput = () => ({
      editorRetained: host?.querySelector('.cm-content') === editor,
      memoCount: listMemos(articleDoc).length,
      memoScreen,
      screenAfterClose,
      outlineScreen,
      screenAfterHeading: readScreen(),
      articleVisible,
      menuItems: [...document.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    })
    expect(readMobileScreensOutput()).toEqual({
      editorRetained: true,
      memoCount: 1,
      memoScreen: { title: 'メモ', toolbar: false },
      screenAfterClose: { title: 'article', toolbar: true },
      outlineScreen: { title: '構成', toolbar: false },
      screenAfterHeading: { title: 'article', toolbar: true },
      articleVisible: true,
      menuItems: ['前提', '設定'],
    })
  })

  it('moves the block at the cursor, undoes, and redoes it from the mobile toolbar', async () => {
    await page.viewport(375, 812)
    const article: Article = {
      id: 'article-mobile-move',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, 'First paragraph.\n\nSecond paragraph.\n')
    let currentView: EditorView | null = null
    renderWorkspace(article, articleDoc, {
      onViewChange: (view) => {
        if (view) currentView = view
      },
    })
    const toolbarButton = (name: string) =>
      page
        .getByRole('toolbar', { name: '入力補助' })
        .getByRole('button', { name })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const view = currentView as EditorView | null
    if (!view) throw new Error('The article editor did not mount')
    view.dispatch({
      selection: EditorSelection.cursor('First paragraph.\n\nSec'.length),
    })
    await act(async () => {
      await userEvent.click(toolbarButton('移動'))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('menuitem', { name: 'Move up' }))
    })
    const movedBody = getBody(articleDoc).toJSON()
    await act(async () => {
      await userEvent.click(toolbarButton('取り消す'))
    })
    const undoneBody = getBody(articleDoc).toJSON()
    await act(async () => {
      await userEvent.click(toolbarButton('やり直す'))
    })

    const readToolbarOutput = () => ({
      movedBody,
      undoneBody,
      redoneBody: getBody(articleDoc).toJSON(),
    })
    expect(readToolbarOutput()).toEqual({
      movedBody: 'Second paragraph.\n\nFirst paragraph.\n',
      undoneBody: 'First paragraph.\n\nSecond paragraph.\n',
      redoneBody: 'Second paragraph.\n\nFirst paragraph.\n',
    })
  })

  it('fits the mobile editor to the visible area while the on-screen keyboard is open', async () => {
    await page.viewport(375, 812)
    const visualViewport = Object.assign(new EventTarget(), {
      offsetTop: 0,
      height: 812,
    })
    vi.stubGlobal('visualViewport', visualViewport)
    const article: Article = {
      id: 'article-mobile-keyboard',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    doc = new Y.Doc()
    renderWorkspace(article, doc)
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const resizeVisualViewport = (offsetTop: number, height: number) => {
      act(() => {
        Object.assign(visualViewport, { offsetTop, height })
        visualViewport.dispatchEvent(new Event('resize'))
      })
      const editorRoot = page
        .getByRole('toolbar', { name: '入力補助' })
        .element().parentElement
      return { top: editorRoot?.style.top, height: editorRoot?.style.height }
    }

    const readAreas = () => ({
      keyboardOpen: resizeVisualViewport(120, 400),
      keyboardClosed: resizeVisualViewport(0, 812),
    })
    expect(readAreas()).toEqual({
      keyboardOpen: { top: '120px', height: '400px' },
      keyboardClosed: { top: '', height: '' },
    })
  })

  it('adds a memo as a heading from the article editor and restores it with undo and redo', async () => {
    const article: Article = {
      id: 'article-m',
      title: 'A draft to explore',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    const initialBody = '# Starting point'
    setBody(articleDoc, initialBody)
    const addedMemo = addMemo(articleDoc, {
      id: 'memo-a',
      text: 'Add a summary',
      order: 0,
    })
    if (addedMemo.isErr()) throw addedMemo.error
    const editorRef: { current: EditorView | null } = { current: null }
    renderWorkspace(article, articleDoc, {
      onViewChange: (view) => {
        editorRef.current = view
      },
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: '採用', exact: true }),
      )
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '末尾に追加' }))
    })
    const readMemoHeadingInsertionOutput = () => ({
      body: getBody(articleDoc).toJSON(),
      editor: editorRef.current?.state.doc.toString() ?? null,
      memos: listMemos(articleDoc).map(({ id, state }) => ({
        id,
        state:
          state.kind === 'adopted'
            ? {
                kind: 'adopted',
                heading: {
                  from: state.heading.from,
                  level: state.heading.level,
                  text: state.heading.text,
                },
              }
            : { kind: state.kind },
      })),
    })
    const historyOutput: {
      action: 'insert' | 'undo' | 'redo'
      state: ReturnType<typeof readMemoHeadingInsertionOutput>
    }[] = []
    historyOutput.push({
      action: 'insert',
      state: readMemoHeadingInsertionOutput(),
    })
    const editor = host?.querySelector<HTMLElement>('.cm-content')
    if (!editor) throw new Error('The article editor did not render')
    const modifier = modifierKey()
    await act(async () => {
      await userEvent.click(editor)
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    historyOutput.push({
      action: 'undo',
      state: readMemoHeadingInsertionOutput(),
    })
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}{Shift>}Z{/Shift}{/${modifier}}`)
    })
    historyOutput.push({
      action: 'redo',
      state: readMemoHeadingInsertionOutput(),
    })
    const expectedOutput = [
      {
        action: 'insert',
        state: {
          body: `${initialBody}\n\n# Add a summary\n\n`,
          editor: `${initialBody}\n\n# Add a summary\n\n`,
          memos: [
            {
              id: 'memo-a',
              state: {
                kind: 'adopted',
                heading: { from: 18, level: 1, text: 'Add a summary' },
              },
            },
          ],
        },
      },
      {
        action: 'undo',
        state: {
          body: initialBody,
          editor: initialBody,
          memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        },
      },
      {
        action: 'redo',
        state: {
          body: `${initialBody}\n\n# Add a summary\n\n`,
          editor: `${initialBody}\n\n# Add a summary\n\n`,
          memos: [
            {
              id: 'memo-a',
              state: {
                kind: 'adopted',
                heading: { from: 18, level: 1, text: 'Add a summary' },
              },
            },
          ],
        },
      },
    ]
    expect(historyOutput).toEqual(expectedOutput)
  })

  it('passes article context and persists premise changes', async () => {
    const article: Article = {
      id: 'article-g',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    let capturedArticleId: string | undefined
    let extensionDoc: Y.Doc | undefined
    let extensionHistory: unknown
    let contextHistory: unknown
    renderWorkspace(article, articleDoc, {
      editorExtensions: ({ doc: extensionDocument, history }) => {
        extensionDoc = extensionDocument
        extensionHistory = history
        return []
      },
      bodyAccessory: () => (
        <div data-testid="body-accessory">Draft request</div>
      ),
      articleNotice: ({ articleId, history }) => {
        capturedArticleId = articleId
        contextHistory = history
        return null
      },
      outlineRenderer: () => (
        <div data-testid="outline-renderer">Outline renderer</div>
      ),
      sourcesPanel: <div data-testid="source-material">Source material</div>,
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('tab', { name: '前提' }))
    })
    const reader = page.getByRole('textbox', { name: '想定読者' })
    await act(async () => {
      await userEvent.clear(reader)
      await userEvent.type(reader, 'Designers')
    })
    const renderedIntegrations = {
      articleId: capturedArticleId,
      sameDocument: extensionDoc === articleDoc,
      sameHistory: extensionHistory === contextHistory,
      bodyAccessory: host?.querySelector('[data-testid="body-accessory"]')
        ?.textContent,
      relativeBodyContainer: host
        ?.querySelector('[data-testid="body-accessory"]')
        ?.parentElement?.classList.contains('relative'),
      outlineRenderer: host?.querySelector('[data-testid="outline-renderer"]')
        ?.textContent,
      sourceMaterial: host?.querySelector('[data-testid="source-material"]')
        ?.textContent,
      savedPremise: articleDoc.getMap('premise').get('audience'),
    }

    const readInjectedOutput = () => ({
      ...renderedIntegrations,
    })
    expect(readInjectedOutput()).toEqual({
      articleId: article.id,
      sameDocument: true,
      sameHistory: true,
      bodyAccessory: 'Draft request',
      relativeBodyContainer: true,
      outlineRenderer: 'Outline renderer',
      sourceMaterial: 'Source material',
      savedPremise: 'Designers',
    })
  })

  it('replaces the premise fields with the injected panel only while the premise tab is selected', async () => {
    const article: Article = {
      id: 'article-premise-toggle',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    renderWorkspace(article, articleDoc, {
      premisePanel: () => <div data-testid="premise-panel">Discussion</div>,
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const readPremiseState = () => ({
      selectedTab: host?.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
      fieldCount:
        host?.querySelectorAll('textarea[id^="premise-"]').length ?? 0,
      panel:
        host?.querySelector('[data-testid="premise-panel"]')?.textContent ??
        null,
    })
    const states = [readPremiseState()]

    await act(async () => {
      await userEvent.click(page.getByRole('tab', { name: '前提' }))
    })
    states.push(readPremiseState())
    await act(async () => {
      await userEvent.click(page.getByRole('tab', { name: 'メモ' }))
    })
    // Base UI removes the previous panel on a later animation frame.
    await vi.waitFor(() => {
      if (readPremiseState().panel !== null)
        throw new Error('The premise panel was not removed')
    })
    states.push(readPremiseState())

    expect(states).toEqual([
      { selectedTab: 'メモ', fieldCount: 0, panel: null },
      { selectedTab: '前提', fieldCount: 0, panel: 'Discussion' },
      { selectedTab: 'メモ', fieldCount: 0, panel: null },
    ])
  })

  it('shares move errors with the outline and clears them after reopening', async () => {
    const article: Article = {
      id: 'article-move-error',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    const initialBody = `# Starting point
`
    setBody(articleDoc, initialBody)
    let attemptInvalidMove: (() => string) | undefined
    renderWorkspace(article, articleDoc, {
      articleNotice: ({ history, view }) => {
        if (!view) return null
        attemptInvalidMove = () =>
          history
            .move({ from: initialBody.length, destination: 0 }, view)
            .match(
              () => 'moved',
              (error) => error.message,
            )
        return null
      },
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const initialOutlineError =
      host?.querySelector('[aria-label="Article outline"] [role="alert"]')
        ?.textContent ?? null
    let invalidMoveResult: string | undefined
    act(() => {
      invalidMoveResult = attemptInvalidMove?.()
    })
    const outlineErrorAfterMove =
      host?.querySelector('[aria-label="Article outline"] [role="alert"]')
        ?.textContent ?? null

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'blog-writer' }))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const outlineErrorAfterReopen =
      host?.querySelector('[aria-label="Article outline"] [role="alert"]')
        ?.textContent ?? null

    const readMoveErrorOutput = () => ({
      initialOutlineError,
      invalidMoveResult,
      outlineErrorAfterMove,
      outlineErrorAfterReopen,
    })
    expect(readMoveErrorOutput()).toEqual({
      initialOutlineError: null,
      invalidMoveResult: 'No Markdown block at position',
      outlineErrorAfterMove: 'この位置には移動できません。',
      outlineErrorAfterReopen: null,
    })
  })

  it('moves to the memo input with the memo shortcut from another tab', async () => {
    const article: Article = {
      id: 'article-memo-shortcut',
      title: 'A fresh draft',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    renderWorkspace(article, articleDoc)
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const modifier = modifierKey()

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '前提を決める' }))
    })
    const tabBeforeShortcut = host?.querySelector(
      '[role="tab"][aria-selected="true"]',
    )?.textContent
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}{Shift>}M{/Shift}{/${modifier}}`)
    })

    const readShortcutOutput = () => ({
      tabBeforeShortcut,
      tabAfterShortcut: host?.querySelector(
        '[role="tab"][aria-selected="true"]',
      )?.textContent,
      focusedElementId: document.activeElement?.id,
    })
    expect(readShortcutOutput()).toEqual({
      tabBeforeShortcut: '前提',
      tabAfterShortcut: 'メモ',
      focusedElementId: 'new-memo',
    })
  })

  it('guides an empty article to the premise or a new memo until a memo exists', async () => {
    const article: Article = {
      id: 'article-empty',
      title: 'A fresh draft',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    renderWorkspace(article, articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const readSelectedTab = () =>
      host?.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    const hasStartButtons = () =>
      [...(host?.querySelectorAll('button') ?? [])].some(
        (button) => button.textContent === '前提を決める',
      )
    const startButtonsBeforeMemo = hasStartButtons()

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '前提を決める' }))
    })
    const tabAfterPremise = readSelectedTab()
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'メモを書く' }))
    })
    const tabAfterMemo = readSelectedTab()
    const focusedElementId = document.activeElement?.id
    await act(async () => {
      await userEvent.keyboard('A first thought')
      await userEvent.keyboard('{Enter}')
    })

    const readEmptyArticleOutput = () => ({
      startButtonsBeforeMemo,
      tabAfterPremise,
      tabAfterMemo,
      focusedElementId,
      startButtonsAfterMemo: hasStartButtons(),
    })
    expect(readEmptyArticleOutput()).toEqual({
      startButtonsBeforeMemo: true,
      tabAfterPremise: '前提',
      tabAfterMemo: 'メモ',
      focusedElementId: 'new-memo',
      startButtonsAfterMemo: false,
    })
  })

  it('hides the empty article guide once the body has text', async () => {
    const article: Article = {
      id: 'article-empty-body',
      title: 'A fresh draft',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    renderWorkspace(article, articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const hasStartButtons = () =>
      [...(host?.querySelectorAll('button') ?? [])].some(
        (button) => button.textContent === '前提を決める',
      )
    const startButtonsBeforeTyping = hasStartButtons()
    const editor = host?.querySelector<HTMLElement>('.cm-content')
    if (!editor) throw new Error('The article editor did not open')
    await act(async () => {
      await userEvent.type(editor, 'A first line')
    })

    const readGuideOutput = () => ({
      startButtonsBeforeTyping,
      startButtonsAfterTyping: hasStartButtons(),
    })
    expect(readGuideOutput()).toEqual({
      startButtonsBeforeTyping: true,
      startButtonsAfterTyping: false,
    })
  })

  it('opens the settings from the editor header', async () => {
    const article: Article = {
      id: 'article-settings',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    const onOpenSettings = vi.fn()
    renderWorkspace(article, articleDoc, { onOpenSettings })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '設定' }))
    })

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('opens the export screen over the hidden editor and returns to the article', async () => {
    const article: Article = {
      id: 'article-export',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    renderWorkspace(article, articleDoc, {
      articleNotice: ({ openExport }) => (
        <button
          onClick={() => {
            openExport('sync')
          }}
          type="button"
        >
          Compare file
        </button>
      ),
      exportScreen: ({ section, syncStatus, onBack }) => (
        <button onClick={onBack} type="button">
          {`Export ${section ?? 'default'} ${syncStatus ?? 'unknown'}`}
        </button>
      ),
    })
    const readScreen = () => ({
      exportScreen:
        [...(host?.querySelectorAll('button') ?? [])].find(({ textContent }) =>
          textContent.startsWith('Export '),
        )?.textContent ?? null,
      editorHidden:
        host?.querySelector('.cm-editor')?.closest('[hidden]') !== null,
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '書き出し' }))
    })
    const fromHeader = readScreen()
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: /^Export / }))
    })
    const afterBack = readScreen()
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'Compare file' }))
    })

    const readExportOutput = () => ({
      fromHeader,
      afterBack,
      fromNotice: readScreen(),
    })
    expect(readExportOutput()).toEqual({
      fromHeader: { exportScreen: 'Export default synced', editorHidden: true },
      afterBack: { exportScreen: null, editorHidden: false },
      fromNotice: { exportScreen: 'Export sync synced', editorHidden: true },
    })
  })

  it('shows sync errors, reauthentication, and the unsynced state', async () => {
    const article: Article = {
      id: 'article-i',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    renderWorkspace(article, articleDoc, {
      requiresAuthentication: true,
      error: 'Sync needs attention.',
      syncStatus: 'unsynced',
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })

    const readSyncOutput = () => ({
      syncError: host?.querySelector('[role="alert"]')?.textContent,
      reauthentication: host?.querySelector('[aria-live="assertive"] button')
        ?.textContent,
      syncState: host?.querySelector('[data-state="unsynced"]')?.textContent,
    })
    expect(readSyncOutput()).toEqual({
      syncError: 'Sync needs attention.',
      reauthentication: 'ログインし直す',
      syncState: '○ 未同期',
    })
  })

  it('shows the offline banner while the browser is offline and removes it after reconnecting', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const article: Article = {
      id: 'article-offline',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    renderWorkspace(article, articleDoc)

    const readBanner = () => host?.querySelector('[role="status"]')?.textContent
    const offlineBanner = readBanner()
    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    const readBannerOutput = () => ({
      offlineBanner,
      onlineBanner: readBanner(),
    })
    expect(readBannerOutput()).toEqual({
      offlineBanner:
        'オフラインです。すべての記事を開いて編集できます。変更は端末に保存され、つながったら同期します。LLM はつながってから使えます。',
      onlineBanner: undefined,
    })
  })

  it('replaces body only while the editor view is available', async () => {
    const article: Article = {
      id: 'article-j',
      title: 'A useful article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n')
    let initialReplacementResult: string | undefined
    let bodyAfterEarlyCall: string | undefined
    let liveReplacement: string | undefined
    let staleReplaceBody: ((value: string) => Result<void, Error>) | undefined
    renderWorkspace(article, articleDoc, {
      articleNotice: ({ replaceBody }) => {
        staleReplaceBody ??= replaceBody
        if (initialReplacementResult === undefined) {
          initialReplacementResult = replaceBody('# Too early\n').match(
            () => 'ready',
            (error) => error.name,
          )
          bodyAfterEarlyCall = getBody(articleDoc).toJSON()
        }
        return (
          <button
            onClick={() => {
              liveReplacement = replaceBody('# Exported body\n').match(
                () => 'ready',
                (error) => error.name,
              )
            }}
            type="button"
          >
            Replace body
          </button>
        )
      },
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'Replace body' }))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'blog-writer' }))
    })
    const staleReplacement = staleReplaceBody?.('# Stale replacement\n')
    const staleReplacementResult = staleReplacement?.match(
      () => 'ready',
      (error) => error.name,
    )
    const bodyAfterStaleCall = getBody(articleDoc).toJSON()

    const readReplaceBodyOutput = () => ({
      initialReplacementResult,
      bodyAfterEarlyCall,
      liveReplacement,
      staleReplacementResult,
      bodyAfterStaleCall,
    })
    expect(readReplaceBodyOutput()).toEqual({
      initialReplacementResult: 'EditorNotReadyError',
      bodyAfterEarlyCall: '# Starting point\n',
      liveReplacement: 'ready',
      staleReplacementResult: 'EditorNotReadyError',
      bodyAfterStaleCall: '# Exported body\n',
    })
  })

  it('keeps a stale body replacement scoped to its original article', async () => {
    const firstArticle: Article = {
      id: 'article-old',
      title: 'First article',
      createdAt: Date.UTC(2026, 0, 15),
    }
    const secondArticle: Article = {
      id: 'article-new',
      title: 'Second article',
      createdAt: Date.UTC(2026, 0, 16),
    }
    const firstDoc = new Y.Doc()
    const secondDoc = new Y.Doc()
    doc = firstDoc
    additionalDocs = [secondDoc]
    setBody(
      firstDoc,
      `# First article body
`,
    )
    setBody(
      secondDoc,
      `# Second article body
`,
    )
    const documents = new Map([
      [firstArticle.id, firstDoc],
      [secondArticle.id, secondDoc],
    ])
    const client: SyncClientApi = {
      start: () => okAsync(undefined),
      openDocument: (id) => ok(documents.get(id) ?? firstDoc),
      createArticle: () => ok(firstArticle),
      updateArticleTitle: () => ok(undefined),
      updateArticleExportSettings: () => ok(undefined),
      listArticles: () => [firstArticle, secondArticle],
      getStatus: () => 'synced',
      getSyncedAt: () => undefined,
      getError: () => undefined,
      requiresAuthentication: () => false,
      subscribe: () => () => {},
      destroy: () => {},
    }
    let staleReplaceBody: ((value: string) => Result<void, Error>) | undefined

    function ArticleEditorPageHarness({ article }: { article: Article }) {
      return (
        <ArticleEditorPage
          article={article}
          client={client}
          articleNotice={({ replaceBody }) => {
            if (article.id === firstArticle.id) {
              staleReplaceBody ??= replaceBody
            }
            return null
          }}
          onBack={() => {}}
          onLoginAgain={() => {}}
          onOpenSettings={() => {}}
          requiresAuthentication={false}
        />
      )
    }

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <StrictMode>
          <ArticleEditorPageHarness article={firstArticle} />
        </StrictMode>,
      )
      await Promise.resolve()
    })
    await act(async () => {
      root?.render(
        <StrictMode>
          <ArticleEditorPageHarness article={secondArticle} />
        </StrictMode>,
      )
      await Promise.resolve()
    })

    const staleResult = staleReplaceBody?.(`# Stale replacement
`)
    const readStaleArticleOutput = () => ({
      staleResult: staleResult?.match(
        () => 'ready',
        (error) => error.name,
      ),
      firstBody: getBody(firstDoc).toJSON(),
      secondBody: getBody(secondDoc).toJSON(),
    })
    expect(readStaleArticleOutput()).toEqual({
      staleResult: 'EditorNotReadyError',
      firstBody: `# First article body
`,
      secondBody: `# Second article body
`,
    })
  })
})
