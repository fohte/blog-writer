import * as Y from 'yjs'

export function getBody(doc: Y.Doc): Y.Text {
  return doc.getText('body')
}

export function readBody(doc: Y.Doc): string {
  return getBody(doc).toJSON()
}

const graphemes = new Intl.Segmenter('ja-JP', { granularity: 'grapheme' })

export function countBodyCharacters(markdown: string): number {
  return Array.from(graphemes.segment(markdown.replace(/[\r\n]/gu, ''))).length
}

export function setBody(doc: Y.Doc, value: string): void {
  const body = getBody(doc)

  doc.transact(() => {
    if (body.length > 0) body.delete(0, body.length)
    if (value.length > 0) body.insert(0, value)
  })
}
