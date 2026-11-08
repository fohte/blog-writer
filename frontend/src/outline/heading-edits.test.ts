import { describe, expect, it } from 'vitest'

import { deriveHeadingTree, flattenHeadingTree } from '#article/index'
import type { Heading } from '#article/types'
import {
  addHeadingBelowChange,
  deleteHeadingChange,
  type HeadingChange,
  outdentHeadingMove,
  renameHeadingChange,
} from '#outline/heading-edits'

function headingNamed(markdown: string, text: string): Heading {
  const heading = flattenHeadingTree(deriveHeadingTree(markdown)).find(
    (candidate) => candidate.text === text,
  )
  if (!heading) throw new Error(`Missing heading: ${text}`)
  return heading
}

function apply(markdown: string, change: HeadingChange | undefined) {
  return change
    ? markdown.slice(0, change.from) + change.insert + markdown.slice(change.to)
    : markdown
}

describe('renameHeadingChange', () => {
  it.each([
    ['## Old\ntext\n', 'Old', 'New', '## New\ntext\n'],
    ['## Old ##\n', 'Old', 'New', '## New\n'],
    ['## Old\n', 'Old', 'Old', '## Old\n'],
    ['# A\n## \ntext\n', '', 'Named', '# A\n## Named\ntext\n'],
    ['## Old', 'Old', '', '## '],
  ])('rewrites the text of %j', (markdown, current, next, expected) => {
    const change = renameHeadingChange(
      markdown,
      headingNamed(markdown, current),
      next,
    )

    expect(apply(markdown, change)).toBe(expected)
  })
})

describe('addHeadingBelowChange', () => {
  it.each([
    [
      'a heading without children as a sibling after its paragraphs',
      '## A\ntext\n## B\n',
      'A',
      '## A\ntext\n## \n## B\n',
    ],
    [
      'a heading with children as its first child',
      '## A\ntext\n### C\nmore\n',
      'A',
      '## A\ntext\n### \n### C\nmore\n',
    ],
    [
      'a section ending in a blank line, keeping the blank line',
      '## A\ntext\n\n## B\n',
      'A',
      '## A\ntext\n\n## \n\n## B\n',
    ],
    [
      'the last heading of a body without a final newline',
      '## A\ntext',
      'A',
      '## A\ntext\n## \n',
    ],
  ])('adds below %s', (_case, markdown, current, expected) => {
    const change = addHeadingBelowChange(
      markdown,
      headingNamed(markdown, current),
    )

    expect(apply(markdown, change)).toBe(expected)
  })
})

describe('deleteHeadingChange', () => {
  it.each([
    [
      'keeps the paragraphs under the previous heading',
      '# A\nu\n## B\nv\n',
      'B',
      '# A\nu\nv\n',
    ],
    [
      'removes one blank line under the heading',
      '# A\n\n## B\n\nv\n',
      'B',
      '# A\n\nv\n',
    ],
    ['deletes the last line of a body', '# A\n## B', 'B', '# A\n'],
  ])('%s', (_case, markdown, current, expected) => {
    const change = deleteHeadingChange(
      markdown,
      headingNamed(markdown, current),
    )

    expect(apply(markdown, change)).toBe(expected)
  })
})

describe('outdentHeadingMove', () => {
  const markdown = '# A\n## B\nu\n## C\n# D\n'
  const tree = deriveHeadingTree(markdown)

  it('moves a child after its parent section at the level of the parent', () => {
    expect(
      outdentHeadingMove(markdown, tree, headingNamed(markdown, 'B')),
    ).toEqual({
      from: markdown.indexOf('## B'),
      destination: markdown.indexOf('# D'),
      headingLevel: 1,
    })
  })

  it('leaves a top-level heading in place', () => {
    expect(
      outdentHeadingMove(markdown, tree, headingNamed(markdown, 'A')),
    ).toBe(undefined)
  })
})
