import { describe, it, expect } from 'vitest'
import {
  createThreadInputSchema,
  createCommentInputSchema,
  createPendingDiscussionInputSchema,
  editPendingDiscussionInputSchema,
  createUrlContextInputSchema,
  snapshotPreflightInputSchema,
  createProjectSnapshotInputSchema,
} from './index'

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

describe('createPendingDiscussionInputSchema', () => {
  it('accepts a valid pending discussion with all fields', () => {
    const parsed = createPendingDiscussionInputSchema.parse({
      author: 'claude',
      type: 'critique',
      body: 'this needs a separate discussion',
      origin_discussion_id: 'c001',
      origin_comment_id: 'c004',
    })
    expect(parsed.author).toBe('claude')
    expect(parsed.type).toBe('critique')
  })

  it('accepts minimal input (author and body only)', () => {
    const parsed = createPendingDiscussionInputSchema.parse({
      author: 'codex',
      body: 'a simple suggestion',
    })
    expect(parsed.body).toBe('a simple suggestion')
    expect(parsed.type).toBeUndefined()
  })

  it('rejects an invalid author', () => {
    expect(() =>
      createPendingDiscussionInputSchema.parse({ author: 'robot', body: 'x' }),
    ).toThrow()
  })

  it('rejects an empty body', () => {
    expect(() =>
      createPendingDiscussionInputSchema.parse({ author: 'claude', body: '  ' }),
    ).toThrow()
  })
})

describe('editPendingDiscussionInputSchema', () => {
  it('accepts a body-only update', () => {
    const parsed = editPendingDiscussionInputSchema.parse({ body: 'new body' })
    expect(parsed.body).toBe('new body')
  })

  it('accepts a type-only update', () => {
    const parsed = editPendingDiscussionInputSchema.parse({ type: 'question' })
    expect(parsed.type).toBe('question')
  })

  it('rejects an empty object (neither field provided)', () => {
    expect(() => editPendingDiscussionInputSchema.parse({})).toThrow()
  })
})

describe('createUrlContextInputSchema', () => {
  it('accepts a valid URL with a label', () => {
    const parsed = createUrlContextInputSchema.parse({
      url: 'https://example.com/spec',
      label: 'Spec',
    })
    expect(parsed.label).toBe('Spec')
  })

  it('rejects an invalid URL', () => {
    expect(() => createUrlContextInputSchema.parse({ url: 'not-a-url' })).toThrow()
  })
})

describe('snapshotPreflightInputSchema', () => {
  it('accepts a source path', () => {
    const parsed = snapshotPreflightInputSchema.parse({ source_path: '/tmp/project' })
    expect(parsed.source_path).toBe('/tmp/project')
  })

  it('rejects an empty source path', () => {
    expect(() => snapshotPreflightInputSchema.parse({ source_path: '  ' })).toThrow()
  })
})

describe('createProjectSnapshotInputSchema', () => {
  it('accepts a source path and confirmation flag', () => {
    const parsed = createProjectSnapshotInputSchema.parse({
      source_path: '/tmp/project',
      confirmed: true,
    })
    expect(parsed.confirmed).toBe(true)
  })
})
