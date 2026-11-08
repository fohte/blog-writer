import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import {
  ResearchProgress,
  type ResearchProgressStatus,
  type ResearchProgressStep,
} from '#components/research-progress'

const steps: ResearchProgressStep[] = [
  { kind: 'search', query: 'query' },
  { kind: 'fetched', url: 'https://example.com/a' },
  { kind: 'unavailable', url: 'http://example.com/b' },
  { kind: 'fetching', url: 'https://example.com/c' },
]

const stoppedRows = [
  '検索 “query”',
  '取得済み example.com/a',
  '取得できず example.com/b',
]

function renderRows(status: ResearchProgressStatus) {
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() => {
    root.render(<ResearchProgress status={status} steps={steps} />)
  })
  const rows = Array.from(host.querySelectorAll('li')).map(
    (row) => row.textContent,
  )
  root.unmount()
  return rows
}

describe('ResearchProgress', () => {
  it.each<[ResearchProgressStatus, string[]]>([
    ['running', [...stoppedRows, '取得中 example.com/c']],
    ['interrupted', stoppedRows],
    ['failed', stoppedRows],
    ['complete', []],
  ])('shows the rows of a %s job', (status, expected) => {
    expect(renderRows(status)).toEqual(expected)
  })
})
