import { describe, expect, it } from 'vitest'

import { droppedClaim } from '#editor/evidence-range'

function transfer(
  values: Record<string, string>,
): Pick<DataTransfer, 'getData'> {
  return { getData: (type) => values[type] ?? '' }
}

describe('evidence drop target', () => {
  it('pairs a dropped URL with the sentence under the drop position', () => {
    expect(
      droppedClaim(
        'First sentence. Second sentence.',
        transfer({ 'text/uri-list': 'https://example.invalid/page' }),
        20,
      ),
    ).toEqual({
      url: 'https://example.invalid/page',
      from: 16,
      to: 32,
      claim: 'Second sentence.',
    })
  })

  it('does not treat a non-URL drop as evidence', () => {
    expect(
      droppedClaim(
        'A sentence.',
        transfer({ 'text/plain': 'ordinary text' }),
        4,
      ),
    ).toEqual(undefined)
  })
})
