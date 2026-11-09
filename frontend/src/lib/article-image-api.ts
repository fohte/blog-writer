import type { components } from '#lib/api/schema.gen.d.ts'
import { request } from '#lib/article-export-api'
import { isRecord } from '#lib/guards'

function isImageUploadResponse(
  value: unknown,
): value is components['schemas']['ImageUploadResponse'] {
  return isRecord(value) && typeof value['src'] === 'string'
}

export function uploadArticleImage(file: File, fetcher: typeof fetch = fetch) {
  const body = new FormData()
  body.append('file', file)
  return request(
    fetcher,
    '/api/images',
    { method: 'POST', body },
    isImageUploadResponse,
    '画像をアップロードできませんでした',
  )
}
