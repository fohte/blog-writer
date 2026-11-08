import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useArticlePulls } from '#hooks/use-article-pulls'
import type { ExportDestination } from '#lib/article-export-api'

const destinations: ExportDestination[] = [
  {
    id: 'site-one',
    repository: 'example/site',
    base_branch: 'main',
    path_template: 'posts/{slug}.md',
    format: 'markdown',
    frontmatter_template: 'title: {{ title }}',
  },
]

function pull(number: number) {
  return {
    article_id: 'article-a',
    number,
    state: 'open',
    url: `https://github.com/example/site/pull/${String(number)}`,
  }
}

function Probe() {
  const { read, reload } = useArticlePulls(destinations)
  return (
    <>
      <output>
        {[
          read('site-one', 'article-a')?.number,
          read('site-two', 'article-a')?.number,
          read(undefined, 'article-a')?.number,
          read('constructor', 'article-a')?.number,
        ].join(',')}
      </output>
      <button onClick={reload} type="button" />
    </>
  )
}

let host: HTMLDivElement
let root: Root
let pendingReads: Array<(pulls: unknown[]) => void>

async function resolveRead(index: number, pulls: unknown[]) {
  await act(async () => {
    pendingReads[index]?.(pulls)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  pendingReads = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          pendingReads.push((pulls) => {
            resolve(Response.json({ pulls }))
          })
        }),
    ),
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root.render(<Probe />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
  vi.unstubAllGlobals()
})

describe('useArticlePulls', () => {
  it('finds the pull request of an article in its own destination only', async () => {
    await resolveRead(0, [pull(14)])

    expect(host.querySelector('output')?.textContent).toBe('14,,,')
  })

  it('ignores a read that finishes after a newer reload', async () => {
    act(() => {
      host.querySelector('button')?.click()
    })
    await resolveRead(1, [pull(15)])
    await resolveRead(0, [pull(14)])

    expect(host.querySelector('output')?.textContent).toBe('15,,,')
  })
})
