import { describe, expect, it } from 'vitest'

import { getBodyRequestContext } from '#proposals/body-request-context'

describe('getBodyRequestContext', () => {
  it('uses the paragraph at the cursor and includes its containing section', () => {
    const text =
      '# Article\n\n## First\nfirst paragraph\ncontinued line\n\n## Second\nother text'
    const cursor = text.indexOf('continued') + 2

    expect(getBodyRequestContext(text, { from: cursor, to: cursor })).toEqual({
      headings: ['# Article', '## First', '## Second'],
      section:
        '## First\n⟪依頼範囲の開始⟫first paragraph\ncontinued line⟪依頼範囲の終了⟫',
      target: 'first paragraph\ncontinued line',
      range: {
        from: text.indexOf('first paragraph'),
        to: text.indexOf('\n\n## Second'),
      },
    })
  })

  it('keeps the exact selection as the replacement range', () => {
    const text = '# Article\n\n## First\nrewrite this sentence'
    const from = text.indexOf('this')

    expect(getBodyRequestContext(text, { from, to: from + 4 })).toEqual({
      headings: ['# Article', '## First'],
      section:
        '## First\nrewrite ⟪依頼範囲の開始⟫this⟪依頼範囲の終了⟫ sentence',
      target: 'this',
      range: { from, to: from + 4 },
    })
  })

  it('uses an empty range on a blank line', () => {
    const text = '# Article\n\n## First\n\nfollowing paragraph'
    const position = text.indexOf('\n\nfollowing') + 1

    expect(
      getBodyRequestContext(text, { from: position, to: position }),
    ).toEqual({
      headings: ['# Article', '## First'],
      section:
        '## First\n⟪依頼範囲の開始⟫⟪依頼範囲の終了⟫\nfollowing paragraph',
      target: '',
      range: { from: position, to: position },
    })
  })

  it('preserves the complete section when the article has no headings', () => {
    const text = '\n\nFirst paragraph\n\nSecond paragraph'
    const from = text.indexOf('Second')

    expect(getBodyRequestContext(text, { from, to: from + 6 })).toEqual({
      headings: [],
      section:
        '\n\nFirst paragraph\n\n⟪依頼範囲の開始⟫Second⟪依頼範囲の終了⟫ paragraph',
      target: 'Second',
      range: { from, to: from + 6 },
    })
  })
})
