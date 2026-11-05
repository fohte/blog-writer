import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import type { Finding, Source } from '#article/index'
import {
  addSource,
  deleteSource,
  listFindings,
  listSources,
  setFindings,
  updateSource,
} from '#article/index'

function readStoredSourceOutput(
  doc: Y.Doc,
  source: Source,
  findings: Finding[],
) {
  return {
    source,
    sourcesMapValueIsYMap:
      doc.getMap('sources').get('source-a') instanceof Y.Map,
    findings,
    findingsMapValueIsYMap:
      doc.getMap('findings').get('finding-a') instanceof Y.Map,
    listedSources: listSources(doc),
    listedFindings: listFindings(doc, 'source-a'),
  }
}

function readSourceDeletionOutput(
  mergedSource: ReturnType<typeof listSources>[number] | undefined,
  removed: boolean,
  sources: ReturnType<typeof listSources>,
  findings: ReturnType<typeof listFindings>,
) {
  return { mergedSource, removed, sources, findings }
}

describe('article sources', () => {
  it('stores typed source and finding data in the document maps', () => {
    const doc = new Y.Doc()
    const source = addSource(doc, {
      id: 'source-a',
      kind: 'url',
      title: '公開資料',
      url: 'https://data.example.invalid/report',
      fileName: null,
      checkedAt: '2026-01-14T00:00:00.000Z',
    })
    const findings = setFindings(doc, 'source-a', [
      {
        id: 'finding-a',
        sourceId: 'source-a',
        text: '利用者数は増加しました。',
        quote: '利用者数は 12% 増加しました。',
      },
    ])

    expect(
      readStoredSourceOutput(
        doc,
        source._unsafeUnwrap(),
        findings._unsafeUnwrap(),
      ),
    ).toEqual({
      source: {
        id: 'source-a',
        kind: 'url',
        title: '公開資料',
        url: 'https://data.example.invalid/report',
        fileName: null,
        checkedAt: '2026-01-14T00:00:00.000Z',
        status: 'ready',
        summary: '',
      },
      sourcesMapValueIsYMap: true,
      findings: [
        {
          id: 'finding-a',
          sourceId: 'source-a',
          text: '利用者数は増加しました。',
          quote: '利用者数は 12% 増加しました。',
        },
      ],
      findingsMapValueIsYMap: true,
      listedSources: [
        {
          id: 'source-a',
          kind: 'url',
          title: '公開資料',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: '2026-01-14T00:00:00.000Z',
          status: 'ready',
          summary: '',
        },
      ],
      listedFindings: [
        {
          id: 'finding-a',
          sourceId: 'source-a',
          text: '利用者数は増加しました。',
          quote: '利用者数は 12% 増加しました。',
        },
      ],
    })
    doc.destroy()
  })

  it('preserves concurrent field updates and removes findings with their source', () => {
    const first = new Y.Doc({ guid: 'article-a' })
    const second = new Y.Doc({ guid: 'article-a' })
    addSource(first, {
      id: 'source-a',
      kind: 'file',
      title: '概要',
      url: null,
      fileName: 'overview.pdf',
      checkedAt: null,
    })
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first))
    updateSource(first, 'source-a', { title: '更新された概要' })
    updateSource(second, 'source-a', { summary: '資料の要約です。' })
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second))
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first))
    setFindings(first, 'source-a', [
      {
        id: 'finding-a',
        sourceId: 'source-a',
        text: '要点です。',
        quote: '本文の引用です。',
      },
    ])
    const mergedSource = listSources(first)[0]
    const removed = deleteSource(first, 'source-a').match(
      () => true,
      () => false,
    )

    expect(
      readSourceDeletionOutput(
        mergedSource,
        removed,
        listSources(first),
        listFindings(first),
      ),
    ).toEqual({
      mergedSource: {
        id: 'source-a',
        kind: 'file',
        title: '更新された概要',
        url: null,
        fileName: 'overview.pdf',
        checkedAt: null,
        status: 'ready',
        summary: '資料の要約です。',
      },
      removed: true,
      sources: [],
      findings: [],
    })
    first.destroy()
    second.destroy()
  })
})
