import { afterEach, describe, expect, it, vi } from 'vitest'

import { uploadArticleImage } from '#lib/article-image-api'

const file = new File(['image bytes'], 'sample.png', { type: 'image/png' })
const src = '/api/images/sample.webp?w=4&h=2'

function upload() {
  return uploadArticleImage(file).match(
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

function respondWith(response: Response) {
  vi.stubGlobal('fetch', () => Promise.resolve(response))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadArticleImage', () => {
  it('posts the image as the file field and returns its source', async () => {
    const sent: unknown[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url, method: init.method, body: await readForm(init.body) })
      return Response.json({ src })
    })

    const readOutcome = async () => ({ result: await upload(), sent })
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
    respondWith(
      Response.json(
        { error: 'Image format is not supported' },
        { status: 415 },
      ),
    )

    expect(await upload()).toEqual({
      result: 'error',
      message:
        '画像をアップロードできませんでした: Image format is not supported',
    })
  })

  it('rejects a response without an image source', async () => {
    respondWith(Response.json({}))

    expect(await upload()).toEqual({
      result: 'error',
      message:
        '画像をアップロードできませんでした: 応答の形式が正しくありません。',
    })
  })
})
