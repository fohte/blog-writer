import { describe, expect, it } from 'vitest'

import { diff } from '#editor/text-diff'

describe('diff', () => {
  it.each([
    {
      name: 'keeps text between separated edits unchanged',
      previous: 'A x B y C',
      next: 'A X B Y C',
      expected: [
        { from: 2, to: 3, insert: 'X' },
        { from: 6, to: 7, insert: 'Y' },
      ],
    },
    {
      name: 'keeps offsets in UTF-16 for astral characters',
      previous: 'A 🦊 B',
      next: 'A 🐈 B',
      expected: [{ from: 2, to: 4, insert: '🐈' }],
    },
    {
      name: 'inserts into empty text',
      previous: '',
      next: 'text',
      expected: [{ from: 0, to: 0, insert: 'text' }],
    },
    {
      name: 'deletes all text',
      previous: 'text',
      next: '',
      expected: [{ from: 0, to: 4, insert: '' }],
    },
  ])('$name', ({ previous, next, expected }) => {
    expect(diff(previous, next)).toEqual(expected)
  })

  it('returns no changes for identical text', () => {
    expect(diff('unchanged', 'unchanged')).toEqual([])
  })

  it('replaces the remaining span when the diff work limit is reached', () => {
    const unchanged = ' anchor '
    const previous = `${'a'.repeat(400)}${unchanged}${'a'.repeat(400)}\n`
    const next = `${'b'.repeat(400)}${unchanged}${'b'.repeat(400)}\n`

    expect(diff(previous, next)).toEqual([
      { from: 0, to: previous.length - 1, insert: next.slice(0, -1) },
    ])
  })
})
