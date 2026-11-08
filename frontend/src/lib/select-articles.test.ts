import { describe, expect, it } from 'vitest'

import { type ArticleSortOrder, selectArticles } from '#lib/select-articles'
import type { Article } from '#lib/sync-client'

const articles: Article[] = [
  { id: 'first', title: 'Morning Routine', createdAt: 100, updatedAt: 400 },
  { id: 'second', title: 'Unedited draft', createdAt: 450 },
  { id: 'third', title: 'Garden notes', createdAt: 200, updatedAt: 500 },
]

const bodies: Record<string, string> = {
  first: 'A short walk before breakfast.',
  second: '',
  third: 'Planting a Short row of beans.',
}

describe('selectArticles', () => {
  it.each<[string, string, ArticleSortOrder, string[]]>([
    [
      'puts recent edits first, using the creation time of an unedited article',
      '',
      'edited',
      ['third', 'second', 'first'],
    ],
    [
      'lists the oldest article first',
      '',
      'created',
      ['first', 'third', 'second'],
    ],
    ['finds a title ignoring case', 'ROUTINE', 'edited', ['first']],
    ['finds body text ignoring case', 'short', 'edited', ['third', 'first']],
    ['ignores surrounding spaces', '  beans ', 'edited', ['third']],
    ['keeps the sort order of matches', 'short', 'created', ['first', 'third']],
    ['returns nothing without a match', 'absent', 'edited', []],
  ])('%s', (_name, query, sortOrder, expected) => {
    expect(
      selectArticles(articles, query, sortOrder, (id) => bodies[id] ?? '').map(
        ({ id }) => id,
      ),
    ).toEqual(expected)
  })
})
