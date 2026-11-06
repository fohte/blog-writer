import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import type { Finding, Source } from '#article/index'
import {
  addEvidence,
  addSource,
  deleteSource,
  listFindings,
  listSources,
  setBody,
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
  removed: boolean,
  sources: ReturnType<typeof listSources>,
  findings: ReturnType<typeof listFindings>,
  evidenceIds: string[],
  transactionCount: number,
) {
  return {
    removed,
    sources,
    findings,
    evidenceIds,
    transactionCount,
  }
}

function readConcurrentSourceMergeOutput(first: Y.Doc, second: Y.Doc) {
  return {
    first: listSources(first),
    second: listSources(second),
  }
}

function readDuplicateSourceOutput(
  result: ReturnType<typeof addSource>,
  sources: ReturnType<typeof listSources>,
) {
  return {
    result: result.match(
      () => ({ kind: 'ok' as const }),
      (error) => ({
        kind: 'error' as const,
        name: error.name,
        message: error.message,
      }),
    ),
    sources,
  }
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

  it('merges concurrent updates to separate source fields', () => {
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

    expect(readConcurrentSourceMergeOutput(first, second)).toEqual({
      first: [
        {
          id: 'source-a',
          kind: 'file',
          title: '更新された概要',
          url: null,
          fileName: 'overview.pdf',
          checkedAt: null,
          status: 'ready',
          summary: '資料の要約です。',
        },
      ],
      second: [
        {
          id: 'source-a',
          kind: 'file',
          title: '更新された概要',
          url: null,
          fileName: 'overview.pdf',
          checkedAt: null,
          status: 'ready',
          summary: '資料の要約です。',
        },
      ],
    })
    first.destroy()
    second.destroy()
  })

  it('deletes a source, its findings, and its evidence in one transaction', () => {
    const first = new Y.Doc()
    addSource(first, {
      id: 'source-a',
      kind: 'file',
      title: '概要',
      url: null,
      fileName: 'overview.pdf',
      checkedAt: null,
    })
    setFindings(first, 'source-a', [
      {
        id: 'finding-a',
        text: '要点です。',
        quote: '本文の引用です。',
      },
    ])
    setBody(first, 'x')
    addEvidence(first, {
      id: 'evidence-a',
      from: 0,
      to: 1,
      claim: 'x',
      sourceId: 'source-a',
      quote: 'A quote.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    let transactionCount = 0
    first.on('afterTransaction', () => {
      transactionCount += 1
    })
    const removed = deleteSource(first, 'source-a').match(
      () => true,
      () => false,
    )

    expect(
      readSourceDeletionOutput(
        removed,
        listSources(first),
        listFindings(first),
        [...first.getMap('evidence').keys()],
        transactionCount,
      ),
    ).toEqual({
      removed: true,
      sources: [],
      findings: [],
      evidenceIds: [],
      transactionCount: 1,
    })
    first.destroy()
  })

  it('preserves the original source when an ID is already present', () => {
    const doc = new Y.Doc()
    addSource(doc, {
      id: 'source-a',
      kind: 'url',
      title: '元の資料',
      url: 'https://data.example.invalid/report',
      fileName: null,
      checkedAt: null,
    })
    const duplicate = addSource(doc, {
      id: 'source-a',
      kind: 'file',
      title: '別の資料',
      url: null,
      fileName: 'overview.pdf',
      checkedAt: null,
    })

    expect(readDuplicateSourceOutput(duplicate, listSources(doc))).toEqual({
      result: {
        kind: 'error',
        name: 'SourceAlreadyExistsError',
        message: 'Source already exists: source-a',
      },
      sources: [
        {
          id: 'source-a',
          kind: 'url',
          title: '元の資料',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: null,
          status: 'ready',
          summary: '',
        },
      ],
    })
    doc.destroy()
  })
})
