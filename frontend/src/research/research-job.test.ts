import { describe, expect, it } from 'vitest'

import {
  mergeResearchStep,
  type ResearchJobProgress,
  runResearchJob,
} from '#research/research-job'

const url = 'https://example.com/a'

function progressEvents(events: unknown[]): typeof fetch {
  const result = {
    analysis: { task: 'key_points', data: { sources: [] } },
    sources: [],
  }
  const body = [
    ...events.map((data) => ({ event: 'progress', data })),
    { event: 'result', data: result },
  ]
    .map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return () =>
    Promise.resolve(
      new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    )
}

async function collectSteps(events: unknown[]) {
  let steps: ResearchJobProgress[] = []
  await runResearchJob(
    progressEvents(events),
    { route: 'server', bridgeUrl: '' },
    { task: 'key_points', question: 'Question' },
    new AbortController().signal,
    (step) => {
      steps = mergeResearchStep(steps, step)
    },
  )
  return steps
}

describe('research job progress', () => {
  it('keeps one row per URL and appends every search', async () => {
    await expect(
      collectSteps([
        { kind: 'search', query: 'same' },
        { kind: 'search', query: 'same' },
        { kind: 'fetching', url },
        { kind: 'fetching', url: 'https://example.com/b' },
        { kind: 'fetched', url },
      ]),
    ).resolves.toEqual([
      { kind: 'search', query: 'same' },
      { kind: 'search', query: 'same' },
      { kind: 'fetched', url },
      { kind: 'fetching', url: 'https://example.com/b' },
    ])
  })

  it('ignores progress of an unknown shape', async () => {
    await expect(
      collectSteps([
        { query: 'no kind' },
        { kind: 'fetched' },
        { kind: 'other', url },
      ]),
    ).resolves.toEqual([])
  })
})
