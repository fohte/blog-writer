import { describe, expect, it } from 'vitest'

import { deriveHeadingTree } from '#article/headings'
import {
  countMoveConflictsByHeading,
  moveConflictDestination,
} from '#article/move-conflict-headings'

const markdown = 'intro\n## Parent\ntext\n### Child\nmore\n## \nlast\n'
const headings = deriveHeadingTree(markdown)
const positionOf = (needle: string) => markdown.indexOf(needle)

describe('moveConflictDestination', () => {
  it.each([
    ['before every heading', positionOf('intro') + 1, undefined],
    [
      'inside a top-level section',
      positionOf('text') + 1,
      { section: '## Parent' },
    ],
    [
      'inside a nested section',
      positionOf('more') + 1,
      { section: '### Child', parent: '## Parent' },
    ],
    [
      'right after the last character of a section',
      positionOf('### Child'),
      { section: '## Parent' },
    ],
    [
      'inside a section whose heading is empty',
      positionOf('last') + 1,
      { section: '## 無題の見出し' },
    ],
  ])('names the section of a target %s', (_case, target, expected) => {
    expect(moveConflictDestination(headings, target)).toEqual(expected)
  })
})

describe('countMoveConflictsByHeading', () => {
  it('counts each conflict under the heading it now sits in', () => {
    const conflicts = [
      { from: positionOf('intro') + 1 },
      { from: positionOf('text') + 1 },
      { from: positionOf('more') + 1 },
      { from: positionOf('more') + 2 },
    ]

    expect(countMoveConflictsByHeading(headings, conflicts)).toEqual({
      [positionOf('## Parent')]: 1,
      [positionOf('### Child')]: 2,
    })
  })
})
