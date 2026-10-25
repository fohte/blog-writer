import { err, ok } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { greet } from '#index'

describe('greet', () => {
  it('should return greeting message', () => {
    expect(greet('World')).toEqual(ok('Hello, World!'))
  })

  it('should return an error for empty string', () => {
    expect(greet('')).toEqual(err(new Error('name must not be empty')))
  })
})
