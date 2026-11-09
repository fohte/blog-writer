import { describe, expect, it } from 'vitest'

import { topLevelBlocks } from '#article/move-block-structure'

describe('topLevelBlocks', () => {
  it('groups an ImageGrid and keeps adjacent CardLinks separate', () => {
    const grid = `<ImageGrid>
![First](https://assets.example.test/first.png)
![Second](https://assets.example.test/second.png)
</ImageGrid>`
    const firstCard = '<CardLink href="https://docs.example.test/first" />'
    const secondCard = '<CardLink href="https://docs.example.test/second" />'
    const markdown = `Before.

${grid}

${firstCard}
${secondCard}

After.`
    const actual = topLevelBlocks(markdown).map((block) => ({
      name: block.name,
      source: markdown.slice(block.from, block.contentTo),
    }))

    expect(actual).toEqual([
      { name: 'Paragraph', source: 'Before.' },
      { name: 'MdxImageGrid', source: grid },
      { name: 'MdxComponentTag', source: firstCard },
      { name: 'MdxComponentTag', source: secondCard },
      { name: 'Paragraph', source: 'After.' },
    ])
  })

  it('leaves an unmatched ImageGrid opener outside a later valid grid', () => {
    const unclosed = '<ImageGrid>'
    const paragraph = 'Paragraph between grids.'
    const grid = `<ImageGrid>
![Sample](https://assets.example.test/sample.png)
</ImageGrid>`
    const markdown = `${unclosed}\n\n${paragraph}\n\n${grid}`
    const actual = topLevelBlocks(markdown).map((block) => ({
      name: block.name,
      source: markdown.slice(block.from, block.contentTo),
    }))

    expect(actual).toEqual([
      { name: 'MdxComponentTag', source: unclosed },
      { name: 'Paragraph', source: paragraph },
      { name: 'MdxImageGrid', source: grid },
    ])
  })
})
