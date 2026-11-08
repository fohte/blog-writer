import { describe, expect, it } from 'vitest'

import { countBodyCharacters } from '#article/index'

describe('countBodyCharacters', () => {
  it.each([
    { name: 'an empty body', markdown: '', expected: 0 },
    { name: 'text without line breaks', markdown: 'abc', expected: 3 },
    { name: 'line feeds', markdown: 'ab\ncd\n\nef', expected: 6 },
    { name: 'carriage returns', markdown: 'ab\r\ncd', expected: 4 },
    { name: 'an emoji joined from several', markdown: 'a👨‍👩‍👧b', expected: 3 },
  ])('counts $name', ({ markdown, expected }) => {
    expect(countBodyCharacters(markdown)).toBe(expected)
  })
})
