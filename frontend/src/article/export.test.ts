import { compile } from '@mdx-js/mdx'
import { describe, expect, it } from 'vitest'

import { exportArticleBody } from '#article/export'

const articleBody = [
  'Literal {x}, 1<2, and <https://example.test>.',
  '',
  'Promise<string>, Map<K, V>, Array<T>, <br>, <CardLink />, <Kbd>Cmd</Kbd>, <SpeakerDeck />, and <ImageGrid />.',
  '',
  '    const value = 1',
  '    return value',
  '',
  '<!-- note */ stays safe -->',
  '',
  '<details>',
  '<summary>More information</summary>',
  'Unclosed tags remain raw JSX.',
].join('\n')

describe('exportArticleBody', () => {
  it('returns Markdown without changing the article body', async () => {
    const result = await exportArticleBody(articleBody, 'markdown').match(
      (value) => value,
      (error) => {
        throw error
      },
    )

    expect(result).toEqual(articleBody)
  })

  it('converts Markdown to MDX with the required syntax changes', async () => {
    const result = await exportArticleBody(articleBody, 'mdx').match(
      (value) => value,
      (error) => {
        throw error
      },
    )

    expect(result).toEqual(
      String.raw`Literal \{x}, 1\<2, and [https://example.test](https://example.test).

Promise\<string>, Map\<K, V>, Array\<T>, <br />, <CardLink />, <Kbd>Cmd</Kbd>, <SpeakerDeck />, and <ImageGrid />.

${'```'}
const value = 1
return value
${'```'}

{/* note *\/ stays safe */}

<details>
<summary>More information</summary>
Unclosed tags remain raw JSX.
`,
    )
  })

  it('produces MDX accepted by the MDX compiler', async () => {
    const result = await exportArticleBody(
      'Text {x} and 1<2. Promise<string> and <br>.\n\n<!-- note */ -->\n\n<details>Info</details>',
      'mdx',
    ).match(
      (value) => value,
      (error) => {
        throw error
      },
    )

    expect((await compile(result)).messages).toEqual([])
  })
})
