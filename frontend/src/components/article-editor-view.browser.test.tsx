import { ok, okAsync } from 'neverthrow'
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import type { ArticleEditorIntegrationProps } from '#components/article-editor-view'
import type { Article, SyncClientApi } from '#lib/sync-client'
import { ArticleWorkspace } from '#pages/article-workspace'

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined

type EditorIntegrations = Pick<
  ArticleEditorIntegrationProps,
  'editorExtensions' | 'onViewChange'
>

function renderWorkspace(
  article: Article,
  articleDoc: Y.Doc,
  { editorExtensions, onViewChange }: EditorIntegrations = {},
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
      getStatus: () => 'synced',
      getError: () => undefined,
      requiresAuthentication: () => false,
      subscribe: () => () => {},
      destroy: () => {},
    }))

    return (
      <ArticleWorkspace
        articles={articles}
        client={client}
        onCreateArticle={() => undefined}
        onOpenSettings={() => {}}
        ready
        requiresAuthentication={false}
        statuses={{ [article.id]: 'synced' }}
        editorExtensions={editorExtensions}
        onViewChange={onViewChange}
      />
    )
  }

  act(() => {
    root?.render(<ArticleWorkspaceHarness />)
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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

    await act(async () => {
      await userEvent.keyboard('{Meta>}z{/Meta}')
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
      viewChanges: [true, false],
      editorCount: 0,
    })
  })
})
