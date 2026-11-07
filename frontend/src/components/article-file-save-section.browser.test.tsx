import { errAsync } from 'neverthrow'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { downloadArticleFile, exportArticleBody } from '#article/export'
import { ArticleFileSaveSection } from '#components/article-file-save-section'

const exportFailure = vi.hoisted(() => ({ active: false }))

vi.mock('#article/export', async (importOriginal) => {
  const original = await importOriginal<typeof import('#article/export')>()
  return {
    ...original,
    exportArticleBody: (
      ...args: Parameters<typeof original.exportArticleBody>
    ) => {
      if (exportFailure.active) {
        return errAsync(new Error('MDX 形式に変換できませんでした。'))
      }
      return original.exportArticleBody(...args)
    },
  }
})

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined
let blob: Blob | undefined
let filename: string | undefined
let revokedUrls: string[] = []

async function readDownload() {
  return [filename, await blob?.text()]
}

function readConversionError() {
  return {
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    filename: filename ?? null,
    downloadStarted: blob !== undefined,
  }
}

beforeAll(async () => {
  // The MDX converter downloads its parser modules on first use, which can outlast vi.waitFor's timeout.
  ;(await exportArticleBody('', 'mdx'))._unsafeUnwrap()
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  blob = undefined
  filename = undefined
  revokedUrls = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    if (value instanceof Blob) blob = value
    return 'blob:article-export'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revokedUrls.push(url)
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filename = this.download
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = undefined
  doc?.destroy()
  doc = undefined
  host?.remove()
  host = undefined
  exportFailure.active = false
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ArticleFileSaveSection', () => {
  it('shows an MDX conversion error without starting a download', async () => {
    exportFailure.active = true
    host = document.createElement('div')
    document.body.append(host)
    const testDoc = new Y.Doc()
    doc = testDoc
    setBody(testDoc, 'A short article body.')
    root = createRoot(host)

    act(() => {
      root?.render(
        <ArticleFileSaveSection
          articleId="sample-article"
          articleTitle="Sample article"
          doc={testDoc}
        />,
      )
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'MDX' }))
      await userEvent.click(page.getByRole('button', { name: 'ダウンロード' }))
    })

    await act(async () => {
      await vi.waitFor(() => {
        expect(readConversionError()).toEqual({
          alert: 'MDX 形式に変換できませんでした。',
          filename: null,
          downloadStarted: false,
        })
      })
    })
  })

  it.each([
    {
      name: 'downloads the latest body as Markdown by default',
      selectMdx: false,
      expected: ['Sample article.md', 'Literal {x} and 1<2.'],
    },
    {
      name: 'downloads the latest body as MDX after the format is selected',
      selectMdx: true,
      expected: ['Sample article.mdx', 'Literal \\{x} and 1\\<2.\n'],
    },
  ] as const)('$name', async ({ selectMdx, expected }) => {
    host = document.createElement('div')
    document.body.append(host)
    const testDoc = new Y.Doc()
    doc = testDoc
    setBody(testDoc, 'An older body.')
    root = createRoot(host)

    act(() => {
      root?.render(
        <ArticleFileSaveSection
          articleId="sample-article"
          articleTitle="Sample article"
          doc={testDoc}
        />,
      )
    })
    setBody(testDoc, 'Literal {x} and 1<2.')

    await act(async () => {
      if (selectMdx) {
        await userEvent.click(page.getByRole('button', { name: 'MDX' }))
      }
      await userEvent.click(page.getByRole('button', { name: 'ダウンロード' }))
    })

    await vi.waitFor(async () => {
      expect(await readDownload()).toEqual(expected)
    })
  })

  it('clears an initial error after the format changes', async () => {
    host = document.createElement('div')
    document.body.append(host)
    const testDoc = new Y.Doc()
    doc = testDoc
    setBody(testDoc, 'A short article body.')
    root = createRoot(host)

    act(() => {
      root?.render(
        <ArticleFileSaveSection
          articleId="sample-article"
          articleTitle="Sample article"
          doc={testDoc}
          initialError="MDX 形式に変換できませんでした。"
        />,
      )
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'MDX' }))
    })

    expect(document.querySelectorAll('[role="alert"]').length).toEqual(0)
  })
})

it('defers revoking the download URL', () => {
  vi.useFakeTimers()

  downloadArticleFile('Sample article.md', 'Article content')
  const callsBeforeTimer = [...revokedUrls]
  vi.runAllTimers()
  const getDownloadLifecycle = () => [callsBeforeTimer, revokedUrls]

  expect(getDownloadLifecycle()).toEqual([[], ['blob:article-export']])
})
