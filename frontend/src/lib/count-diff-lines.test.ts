import { describe, expect, it } from 'vitest'

import { countDiffLines } from '#lib/count-diff-lines'

describe('countDiffLines', () => {
  it.each([
    ['identical text', 'a\nb\n', 'a\nb\n', { added: 0, removed: 0 }],
    ['a replaced line', 'a\nb\n', 'a\nc\n', { added: 1, removed: 1 }],
    ['appended lines', 'a\n', 'a\nb\nc\n', { added: 2, removed: 0 }],
    ['a removed line', 'a\nb\n', 'a\n', { added: 0, removed: 1 }],
    ['a new file', '', 'a\nb\n', { added: 2, removed: 0 }],
    ['an emptied file', 'a\n', '', { added: 0, removed: 1 }],
    [
      'different line endings',
      'a\r\nb\r\n',
      'a\nb\n',
      { added: 0, removed: 0 },
    ],
  ])('counts %s', (_name, original, modified, expected) => {
    expect(countDiffLines(original, modified)).toEqual(expected)
  })
})
