import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { getBody, moveBlock, setBody } from '#article/index'

const docs: Y.Doc[] = []

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy()
})

describe('moveBlock heading boundaries', () => {
  it('moves a heading section when the position is at the heading line end', () => {
    const initial = `# A

aaa

# B

bbb

# C

ccc
`
    const doc = new Y.Doc()
    docs.push(doc)
    setBody(doc, initial)
    const headingLineEnd = initial.indexOf('# B') + '# B'.length
    const move = moveBlock(doc, { from: headingLineEnd, destination: 0 })
    const actual = move.match(
      (value) => ({
        moveSucceeded: true,
        movedRange: { from: value.from, to: value.to },
        body: getBody(doc).toJSON(),
      }),
      (error) => ({ moveSucceeded: false, error: error.message }),
    )

    expect(actual).toEqual({
      moveSucceeded: true,
      movedRange: { from: 0, to: 9 },
      body: `# B

bbb

# A

aaa

# C

ccc
`,
    })
  })
})
