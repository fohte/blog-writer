import { describe, expect, it } from 'vitest'

import { uploadArticleImage } from '#lib/article-image-api'

const file = new File(['image bytes'], 'sample.png', { type: 'image/png' })
const src = '/api/images/sample.webp?w=4&h=2'

function upload(fetcher: typeof fetch) {
  return uploadArticleImage(file, fetcher).match(
    (value) => ({ result: 'ok', value }),
    (error) => ({ result: 'error', message: error.message }),
  )
}

// A File has no enumerable fields, so an equality check on it would accept any file.
function readForm(body: RequestInit['body']) {
  if (!(body instanceof FormData)) return body
  return Promise.all(
    [...body.entries()].map(async ([key, value]) => [
      key,
      typeof value === 'string'
        ? value
        : { name: value.name, type: value.type, text: await value.text() },
    ]),
  )
}

describe('uploadArticleImage', () => {
  it('posts the image as the file field and returns its source', async () => {
    const sent: unknown[] = []
    const fetcher: typeof fetch = async (url, init) => {
      sent.push({ url, method: init?.method, body: await readForm(init?.body) })
      return Response.json({ src })
    }

    const readOutcome = async () => ({ result: await upload(fetcher), sent })
    expect(await readOutcome()).toEqual({
      result: { result: 'ok', value: { src } },
      sent: [
        {
          url: '/api/images',
          method: 'POST',
          body: [
            [
              'file',
              {
                name: 'sample.png',
                type: 'image/png',
                text: 'image bytes',
              },
            ],
          ],
        },
      ],
    })
  })

  it('reports why the server rejected the image', async () => {
    const actual = await upload(() =>
      Promise.resolve(
        Response.json(
          { error: 'Image format is not supported' },
          { status: 415 },
        ),
      ),
    )

    expect(actual).toEqual({
      result: 'error',
      message:
        '画像をアップロードできませんでした: Image format is not supported',
    })
  })

  it('rejects a response without an image source', async () => {
    const actual = await upload(() => Promise.resolve(Response.json({})))

    expect(actual).toEqual({
      result: 'error',
      message:
        '画像をアップロードできませんでした: 応答の形式が正しくありません。',
    })
  })
})
