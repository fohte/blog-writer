import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ArticleExportPopover } from '#components/article-export-popover'

let host: HTMLDivElement | undefined
let root: Root | undefined
let blob: Blob | undefined
let filename: string | undefined

async function readDownload() {
  return [filename, await blob?.text()]
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  blob = undefined
  filename = undefined
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    if (value instanceof Blob) blob = value
    return 'blob:article-export'
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
  host?.remove()
  host = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ArticleExportPopover', () => {
  it.each([
    {
      name: 'downloads the default Markdown format unchanged',
      format: undefined,
      expected: ['sample-article.md', 'Literal {x} and 1<2.'],
    },
    {
      name: 'downloads MDX after the format is selected',
      format: 'mdx',
      expected: [
        'sample-article.mdx',
        String.raw`Literal \{x} and 1\<2.
`,
      ],
    },
  ] as const)('$name', async ({ format, expected }) => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    act(() => {
      root?.render(
        <ArticleExportPopover
          articleId="sample-article"
          body="Literal {x} and 1<2."
        />,
      )
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '書き出す' }))
      if (format !== undefined) {
        await userEvent.click(page.getByRole('button', { name: 'MDX' }))
      }
      await userEvent.click(page.getByRole('button', { name: 'ダウンロード' }))
    })

    await vi.waitFor(async () => {
      expect(await readDownload()).toEqual(expected)
    })
  })
})
