import { describe, expect, it } from 'vitest'

import { deriveHeadingTree } from '#article/headings'

describe('deriveHeadingTree', () => {
  it('parses a heading immediately after an ImageGrid block', () => {
    const markdown =
      '<ImageGrid>\n![a](x)\n</ImageGrid>\n## Right after grid\n\nbody'

    expect(deriveHeadingTree(markdown)).toEqual([
      {
        level: 2,
        text: 'Right after grid',
        from: 33,
        to: 52,
        children: [],
      },
    ])
  })
})
