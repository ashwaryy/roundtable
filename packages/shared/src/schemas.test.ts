import { describe, it, expect } from 'vitest'
import {
  createThreadInputSchema,
  createCommentInputSchema,
  createPendingDiscussionInputSchema,
  editPendingDiscussionInputSchema,
  createUrlContextInputSchema,
  snapshotPreflightInputSchema,
  createProjectSnapshotInputSchema,
  askAgentInputSchema,
  requestIdleSuggestionInputSchema,
  extendAutoDiscussionInputSchema,
  helperCommentInputSchema,
  helperPendingDiscussionInputSchema,
  sendRoomInputResponseInputSchema,
  startAutoDiscussionInputSchema,
  tmuxPaneInputSchema,
  createAgentInputSchema,
  agentColorPresetSchema,
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

  it('accepts a agent id as author', () => {
    expect(createPendingDiscussionInputSchema.parse({ author: 'agent-architect', body: 'x' }).author)
      .toBe('agent-architect')
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

describe('askAgentInputSchema', () => {
  it('accepts a thread-level ask', () => {
    const parsed = askAgentInputSchema.parse({
      agent: 'claude',
      body: 'review this',
    })
    expect(parsed.agent).toBe('claude')
    expect(parsed.body).toBe('review this')
  })

  it('accepts a discussion-level ask', () => {
    const parsed = askAgentInputSchema.parse({
      agent: 'codex',
      discussion_id: 'c001',
    })
    expect(parsed.discussion_id).toBe('c001')
  })

  it('accepts a backend-owned agent id', () => {
    expect(askAgentInputSchema.parse({ agent: 'agent-architect' }).agent).toBe('agent-architect')
  })
})

describe('requestIdleSuggestionInputSchema', () => {
  it('accepts a targeted idle suggestion request', () => {
    const parsed = requestIdleSuggestionInputSchema.parse({
      agent: 'claude',
      body: 'Look for performance topics.',
    })
    expect(parsed.body).toBe('Look for performance topics.')
  })
})

describe('agent schemas', () => {
  it('validates agent configuration and preset colors', () => {
    const parsed = createAgentInputSchema.parse({
      name: 'Architect', runtime: 'codex', effort: 'xhigh', color: 'teal',
    })
    expect(parsed.name).toBe('Architect')
    expect(agentColorPresetSchema.parse('rose')).toBe('rose')
    expect(() => agentColorPresetSchema.parse('#fff')).toThrow()
  })

  it('validates runtime-aware effort', () => {
    expect(createAgentInputSchema.parse({
      name: 'Claude', runtime: 'claude', effort: 'max',
    }).effort).toBe('max')
    expect(createAgentInputSchema.parse({
      name: 'Claude', runtime: 'claude', effort: 'xhigh',
    }).effort).toBe('xhigh')
    expect(() => createAgentInputSchema.parse({
      name: 'Codex', runtime: 'codex', effort: 'max',
    })).toThrow()
  })
})

describe('startAutoDiscussionInputSchema', () => {
  it('accepts a bounded auto discussion request', () => {
    const parsed = startAutoDiscussionInputSchema.parse({
      turn_count: 4,
      allow_direct_roots: true,
    })
    expect(parsed.turn_count).toBe(4)
    expect(parsed.allow_direct_roots).toBe(true)
  })

  it('rejects turn counts outside the supported range', () => {
    expect(() => startAutoDiscussionInputSchema.parse({ turn_count: 0 })).toThrow()
    expect(() => startAutoDiscussionInputSchema.parse({ turn_count: 21 })).toThrow()
  })
})

describe('extendAutoDiscussionInputSchema', () => {
  it('accepts an extension turn count', () => {
    const parsed = extendAutoDiscussionInputSchema.parse({ turn_count: 2 })
    expect(parsed.turn_count).toBe(2)
  })
})

describe('sendRoomInputResponseInputSchema', () => {
  it('accepts yes/no input responses', () => {
    const parsed = sendRoomInputResponseInputSchema.parse({
      agent: 'codex',
      response: 'yes',
    })
    expect(parsed.agent).toBe('codex')
    expect(parsed.response).toBe('yes')
  })

  it('rejects unsupported input responses', () => {
    expect(() =>
      sendRoomInputResponseInputSchema.parse({
        agent: 'codex',
        response: 'maybe',
      }),
    ).toThrow()
  })
})

describe('tmuxPaneInputSchema', () => {
  it('accepts allowed tmux key input', () => {
    expect(tmuxPaneInputSchema.parse({ type: 'key', key: 'CtrlC' })).toEqual({
      type: 'key',
      key: 'CtrlC',
    })
  })

  it('accepts bounded literal text input', () => {
    expect(tmuxPaneInputSchema.parse({ type: 'text', text: 'hello' })).toEqual({
      type: 'text',
      text: 'hello',
    })
  })

  it('rejects unknown keys and empty text', () => {
    expect(() => tmuxPaneInputSchema.parse({ type: 'key', key: 'F12' })).toThrow()
    expect(() => tmuxPaneInputSchema.parse({ type: 'text', text: '' })).toThrow()
  })
})

describe('helperCommentInputSchema', () => {
  it('accepts a helper comment submission', () => {
    const parsed = helperCommentInputSchema.parse({
      turn_id: 'job-001',
      agent: 'claude',
      body: 'comment body',
      type: 'critique',
      discussion_id: 'c001',
    })
    expect(parsed.type).toBe('critique')
    expect(parsed.discussion_id).toBe('c001')
  })

  it('rejects an empty helper body', () => {
    expect(() =>
      helperCommentInputSchema.parse({
        turn_id: 'job-001',
        agent: 'claude',
        body: '  ',
      }),
    ).toThrow()
  })
})

describe('helperPendingDiscussionInputSchema', () => {
  it('accepts a helper pending discussion submission', () => {
    const parsed = helperPendingDiscussionInputSchema.parse({
      turn_id: 'job-001',
      agent: 'codex',
      body: 'new root',
      type: 'question',
      origin_discussion_id: 'c001',
      continue_turn: true,
    })
    expect(parsed.agent).toBe('codex')
    expect(parsed.origin_discussion_id).toBe('c001')
    expect(parsed.continue_turn).toBe(true)
  })

  it('accepts an idle helper pending discussion without a turn id', () => {
    const parsed = helperPendingDiscussionInputSchema.parse({
      agent: 'codex',
      body: 'idle suggestion',
    })
    expect(parsed.turn_id).toBeUndefined()
  })

  it('rejects empty pending discussion bodies', () => {
    expect(() =>
      helperPendingDiscussionInputSchema.parse({
        turn_id: 'job-001',
        agent: 'codex',
        body: '  ',
      }),
    ).toThrow()
  })
})
