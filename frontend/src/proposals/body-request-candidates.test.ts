import { describe, expect, it } from 'vitest'

import { editCandidatesFor } from '#proposals/body-request-candidates'

describe('editCandidatesFor', () => {
  it.each([
    {
      name: 'a selection',
      situation: { target: 'selection', hasHeading: true, hasPremise: false },
      expected: ['簡潔にする', '前後とのつながりを直す'],
    },
    {
      name: 'a paragraph',
      situation: { target: 'paragraph', hasHeading: true, hasPremise: false },
      expected: ['簡潔にする', '例を 1 つ足す', '前後とのつながりを直す'],
    },
    {
      name: 'a paragraph in an article with a premise',
      situation: { target: 'paragraph', hasHeading: true, hasPremise: true },
      expected: [
        '簡潔にする',
        '例を 1 つ足す',
        '前後とのつながりを直す',
        '前提に沿って直す',
      ],
    },
    {
      name: 'an insertion in an article with a premise',
      situation: { target: 'insertion', hasHeading: true, hasPremise: true },
      expected: ['例を 1 つ足す'],
    },
  ] as const)('lists the edits that fit $name', ({ situation, expected }) => {
    const labels = editCandidatesFor(situation).map(({ label }) => label)

    expect(labels).toEqual(expected)
  })
})
