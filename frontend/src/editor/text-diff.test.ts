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

  it('keeps separated edits in a large imported body unchanged', () => {
    const blocks = [
      { previous: 'a', next: 'A' },
      { previous: 'c', next: 'C' },
      { previous: 'e', next: 'E' },
      { previous: 'g', next: 'G' },
      { previous: 'i', next: 'I' },
      { previous: 'k', next: 'K' },
      { previous: 'm', next: 'M' },
      { previous: 'o', next: 'O' },
      { previous: 'q', next: 'Q' },
      { previous: 's', next: 'S' },
      { previous: 'u', next: 'U' },
    ]
    const previous = blocks
      .map(({ previous }) => `${previous}: ${'x'.repeat(1_800)}`)
      .join('|')
    const next = blocks
      .map(({ next }) => `${next}: ${'x'.repeat(1_800)}`)
      .join('|')

    expect(diff(previous, next)).toEqual([
      { from: 0, to: 1, insert: 'A' },
      { from: 1_804, to: 1_805, insert: 'C' },
      { from: 3_608, to: 3_609, insert: 'E' },
      { from: 5_412, to: 5_413, insert: 'G' },
      { from: 7_216, to: 7_217, insert: 'I' },
      { from: 9_020, to: 9_021, insert: 'K' },
      { from: 10_824, to: 10_825, insert: 'M' },
      { from: 12_628, to: 12_629, insert: 'O' },
      { from: 14_432, to: 14_433, insert: 'Q' },
      { from: 16_236, to: 16_237, insert: 'S' },
      { from: 18_040, to: 18_041, insert: 'U' },
    ])
  })

  it('replaces the remaining span when the diff work limit is reached', () => {
    const unchanged = ' anchor '
    const previous = `${'a'.repeat(4_000)}${unchanged}${'a'.repeat(4_000)}\n`
    const next = `${'b'.repeat(4_000)}${unchanged}${'b'.repeat(4_000)}\n`

    expect(diff(previous, next)).toEqual([
      { from: 0, to: previous.length - 1, insert: next.slice(0, -1) },
    ])
  })
})
