import { describe, it, expect } from 'vitest'
import { createThreadInputSchema, createCommentInputSchema } from './index'

describe('createThreadInputSchema', () => {
  it('accepts a title and body', () => {
    const parsed = createThreadInputSchema.parse({ title: 'T', body: 'B' })
    expect(parsed).toEqual({ title: 'T', body: 'B' })
  })

  it('rejects an empty title', () => {
    expect(() =>
      createThreadInputSchema.parse({ title: '   ', body: 'B' }),
    ).toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => createThreadInputSchema.parse({ title: 'T', body: '' })).toThrow()
  })
})

describe('createCommentInputSchema', () => {
  it('accepts a body only (top-level)', () => {
    const parsed = createCommentInputSchema.parse({ body: 'hello' })
    expect(parsed.body).toBe('hello')
    expect(parsed.reply_to).toBeUndefined()
  })

  it('accepts a reply_to and type', () => {
    const parsed = createCommentInputSchema.parse({
      body: 'reply',
      type: 'critique',
      reply_to: 'c001',
    })
    expect(parsed.reply_to).toBe('c001')
    expect(parsed.type).toBe('critique')
  })

  it('rejects an invalid type', () => {
    expect(() =>
      createCommentInputSchema.parse({ body: 'x', type: 'bogus' }),
    ).toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => createCommentInputSchema.parse({ body: '   ' })).toThrow()
  })
})
