import { describe, expect, it } from 'vitest'

import { getArticlePulls, getExportDestinations } from '#lib/article-export-api'

const destination = {
  id: 'sample-site',
  repository: 'example/site',
  base_branch: 'main',
  path_template: 'posts/{slug}.md',
  format: 'markdown',
  frontmatter_template: 'title: {{ title }}',
}

function readDestinations(payload: unknown) {
  return getExportDestinations(() =>
    Promise.resolve(Response.json(payload)),
  ).match(
    (value) => ({ result: 'ok', value }),
    (error) => ({ result: 'error', message: error.message }),
  )
}

describe('getArticlePulls', () => {
  function readPulls(payload: unknown) {
    return getArticlePulls(
      () => Promise.resolve(Response.json(payload)),
      'sample-site',
    ).match(
      (value) => ({ result: 'ok', value }),
      (error) => ({ result: 'error', message: error.message }),
    )
  }
  const pull = {
    article_id: 'sample-article',
    number: 14,
    state: 'open',
    url: 'https://github.com/example/site/pull/14',
  }

  it('accepts the pull requests of a destination', async () => {
    const actual = await readPulls({ pulls: [pull] })

    expect(actual).toEqual({ result: 'ok', value: { pulls: [pull] } })
  })

  it('rejects an unknown pull request state', async () => {
    const actual = await readPulls({ pulls: [{ ...pull, state: 'draft' }] })

    expect(actual).toEqual({
      result: 'error',
      message:
        'PR の状態を読み込めませんでした: 応答の形式が正しくありません。',
    })
  })
})

describe('getExportDestinations', () => {
  it('accepts a destination with every field the publish form shows', async () => {
    const actual = await readDestinations({ destinations: [destination] })

    expect(actual).toEqual({
      result: 'ok',
      value: { destinations: [destination] },
    })
  })

  it.each(['repository', 'base_branch', 'path_template'])(
    'rejects a destination without %s',
    async (field) => {
      const incomplete = Object.fromEntries(
        Object.entries(destination).filter(([key]) => key !== field),
      )
      const actual = await readDestinations({ destinations: [incomplete] })

      expect(actual).toEqual({
        result: 'error',
        message: '公開先を読み込めませんでした: 応答の形式が正しくありません。',
      })
    },
  )
})
