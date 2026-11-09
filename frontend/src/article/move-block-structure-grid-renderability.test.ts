import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { getBody, moveBlock, setBody } from '#article/index'
import { topLevelBlocks } from '#article/move-block-structure'

const docs: Y.Doc[] = []

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy()
})

function moveBlockAt(markdown: string, marker: string, destination: number) {
  const doc = new Y.Doc()
  docs.push(doc)
  setBody(doc, markdown)
  const result = moveBlock(doc, {
    from: markdown.indexOf(marker),
    destination,
  })

  return result.match(
    () => ({ success: true, body: getBody(doc).toJSON() }),
    (error) => ({
      success: false,
      body: getBody(doc).toJSON(),
      error: error.message,
    }),
  )
}

describe('ImageGrid move structure', () => {
  it('keeps paragraphs independently movable inside an unrenderable grid', () => {
    const image = '![Sample](https://assets.example.test/sample.png)'
    const grid = `<ImageGrid>
${image}

Para one

Para two
</ImageGrid>`
    const markdown = `${grid}

After.`
    const blocks = topLevelBlocks(markdown).map((block) => ({
      name: block.name,
      source: markdown.slice(block.from, block.contentTo),
    }))
    const move = moveBlockAt(markdown, 'Para two', markdown.indexOf('Para one'))

    const readOutput = () => ({ blocks, move })
    expect(readOutput()).toEqual({
      blocks: [
        { name: 'MdxComponentTag', source: '<ImageGrid>' },
        { name: 'Paragraph', source: image },
        { name: 'Paragraph', source: 'Para one' },
        { name: 'Paragraph', source: 'Para two' },
        { name: 'MdxComponentTag', source: '</ImageGrid>' },
        { name: 'Paragraph', source: 'After.' },
      ],
      move: {
        success: true,
        body: `<ImageGrid>
${image}

Para two

Para one

</ImageGrid>

After.`,
      },
    })
  })

  it('allows moving a heading from an unrenderable grid', () => {
    const markdown = `<ImageGrid>

## Inner

x

</ImageGrid>

## Next

y`
    const move = moveBlockAt(markdown, '## Inner', markdown.length)

    expect(move).toEqual({
      success: true,
      body: `<ImageGrid>

## Next

y

## Inner

x

</ImageGrid>
`,
    })
  })

  it('keeps indented ImageGrid tags out of the component block sequence', () => {
    const image = '![Sample](https://assets.example.test/sample.png)'
    const markdown = `  <ImageGrid>
${image}
  </ImageGrid>`
    const actual = topLevelBlocks(markdown).map((block) => ({
      name: block.name,
      source: markdown.slice(block.from, block.contentTo),
    }))

    expect(actual).toEqual([
      { name: 'MdxComponentTag', source: '<ImageGrid>' },
      { name: 'Paragraph', source: image },
      { name: 'MdxComponentTag', source: '</ImageGrid>' },
    ])
  })

  it('pairs top-level ImageGrid tags with trailing horizontal whitespace', () => {
    const image = '![Sample](https://assets.example.test/sample.png)'
    const markdown = ['<ImageGrid> \t', image, '</ImageGrid> \t'].join('\n')
    const actual = topLevelBlocks(markdown).map((block) => block.name)

    expect(actual).toEqual(['MdxImageGrid'])
  })

  it.each([
    { name: 'malformed', image: '![Sample](' },
    { name: 'reference-style', image: '![Sample][sample]' },
  ])('keeps a grid with a $name image in ordinary blocks', ({ image }) => {
    const markdown = `<ImageGrid>
${image}
</ImageGrid>`
    const actual = topLevelBlocks(markdown).map((block) => ({
      name: block.name,
      source: markdown.slice(block.from, block.contentTo),
    }))

    expect(actual).toEqual([
      { name: 'MdxComponentTag', source: '<ImageGrid>' },
      { name: 'Paragraph', source: image },
      { name: 'MdxComponentTag', source: '</ImageGrid>' },
    ])
  })
})
