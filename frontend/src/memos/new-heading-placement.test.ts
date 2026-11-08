import { describe, expect, it } from 'vitest'

import { deriveHeadingTree } from '#article/index'
import {
  type NewHeadingPlacement,
  resolveNewHeadingPlacement,
} from '#memos/new-heading-placement'

const article = '## Alpha\n\ntext\n\n### Child\n\nmore\n\n## Beta\n'

describe('resolveNewHeadingPlacement', () => {
  it.each<{
    name: string
    markdown: string
    cursor: number
    expected: NewHeadingPlacement
  }>([
    {
      name: 'goes one level below, after the children of the cursor heading',
      markdown: article,
      cursor: article.indexOf('text'),
      expected: {
        anchor: { level: 2, text: 'Alpha' },
        beforeFrom: article.indexOf('## Beta'),
        levels: [2, 3],
        defaultLevel: 3,
      },
    },
    {
      name: 'stays inside the parent section under a nested heading',
      markdown: article,
      cursor: article.indexOf('more'),
      expected: {
        anchor: { level: 3, text: 'Child' },
        beforeFrom: article.indexOf('## Beta'),
        levels: [3, 4],
        defaultLevel: 4,
      },
    },
    {
      name: 'treats a cursor on the heading line as inside that heading',
      markdown: article,
      cursor: article.indexOf('## Beta'),
      expected: {
        anchor: { level: 2, text: 'Beta' },
        beforeFrom: undefined,
        levels: [2, 3],
        defaultLevel: 3,
      },
    },
    {
      name: 'offers only level six under a level six heading',
      markdown: '###### Deepest\n',
      cursor: 0,
      expected: {
        anchor: { level: 6, text: 'Deepest' },
        beforeFrom: undefined,
        levels: [6],
        defaultLevel: 6,
      },
    },
    {
      name: 'appends at the last heading level above the first heading',
      markdown: 'intro\n\n### Later\n',
      cursor: 0,
      expected: {
        anchor: undefined,
        beforeFrom: undefined,
        levels: [3, 4],
        defaultLevel: 3,
      },
    },
    {
      name: 'uses level two in an article without headings',
      markdown: 'body',
      cursor: 2,
      expected: {
        anchor: undefined,
        beforeFrom: undefined,
        levels: [2, 3],
        defaultLevel: 2,
      },
    },
  ])('$name', ({ markdown, cursor, expected }) => {
    expect(
      resolveNewHeadingPlacement(deriveHeadingTree(markdown), cursor),
    ).toEqual(expected)
  })
})
