import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createThread } from './threads'
import {
  createProposal,
  getProposal,
  listProposals,
  addProposalRevision,
  getLatestRevision,
  listRevisions,
} from './proposals'
import { proposalJsonPath } from './paths'
import { NotFoundError } from './errors'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-proposals-'))
  createThread(dataDir, { title: 'T', body: 'body' })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('createProposal', () => {
  it('creates a proposal with status drafting and null fields', () => {
    const proposal = createProposal(dataDir, 'thread-1', {})
    expect(proposal.id).toBe('consolidation-001')
    expect(proposal.thread_id).toBe('thread-1')
    expect(proposal.status).toBe('drafting')
    expect(proposal.summary).toBeNull()
    expect(proposal.latest_revision_id).toBeNull()
    expect(proposal.latest_review_id).toBeNull()
    expect(proposal.applied_thread_id).toBeNull()
    expect(typeof proposal.created_at).toBe('string')
  })

  it('stores a summary when provided', () => {
    const proposal = createProposal(dataDir, 'thread-1', {
      summary: 'clarified retries',
    })
    expect(proposal.summary).toBe('clarified retries')
  })

  it('assigns incrementing ids', () => {
    const a = createProposal(dataDir, 'thread-1', {})
    const b = createProposal(dataDir, 'thread-1', {})
    expect(a.id).toBe('consolidation-001')
    expect(b.id).toBe('consolidation-002')
  })

  it('throws NotFoundError for a missing thread', () => {
    expect(() => createProposal(dataDir, 'thread-999', {})).toThrow(NotFoundError)
  })
})

describe('getProposal', () => {
  it('returns null for a missing proposal', () => {
    expect(getProposal(dataDir, 'thread-1', 'consolidation-999')).toBeNull()
  })

  it('returns the proposal after creation', () => {
    const created = createProposal(dataDir, 'thread-1', { summary: 'test' })
    const fetched = getProposal(dataDir, 'thread-1', created.id)
    expect(fetched?.summary).toBe('test')
    expect(fetched?.status).toBe('drafting')
  })
})

describe('listProposals', () => {
  it('returns [] when no proposals exist', () => {
    expect(listProposals(dataDir, 'thread-1')).toEqual([])
  })

  it('returns proposals in creation order (oldest first)', () => {
    createProposal(dataDir, 'thread-1', {})
    createProposal(dataDir, 'thread-1', {})
    const ids = listProposals(dataDir, 'thread-1').map((proposal) => proposal.id)
    expect(ids).toEqual(['consolidation-001', 'consolidation-002'])
  })
})

describe('addProposalRevision / getLatestRevision / listRevisions', () => {
  it('adds a revision and returns a ProposalRevision with id and metadata', () => {
    const proposal = createProposal(dataDir, 'thread-1', {})
    const revision = addProposalRevision(
      dataDir,
      'thread-1',
      proposal.id,
      '# Draft\nbody',
      'human',
    )
    expect(revision.id).toBe('r001')
    expect(revision.proposal_id).toBe(proposal.id)
    expect(revision.thread_id).toBe('thread-1')
    expect(revision.author).toBe('human')
    expect(typeof revision.created_at).toBe('string')
    expect(getProposal(dataDir, 'thread-1', proposal.id)?.latest_revision_id).toBe('r001')
  })

  it('assigns incrementing revision ids', () => {
    const proposal = createProposal(dataDir, 'thread-1', {})
    const first = addProposalRevision(
      dataDir,
      'thread-1',
      proposal.id,
      'first draft',
      'human',
    )
    const second = addProposalRevision(
      dataDir,
      'thread-1',
      proposal.id,
      'second draft',
      'claude',
    )
    expect(first.id).toBe('r001')
    expect(second.id).toBe('r002')
  })

  it('rejects an empty body', () => {
    const proposal = createProposal(dataDir, 'thread-1', {})
    expect(() =>
      addProposalRevision(dataDir, 'thread-1', proposal.id, '   ', 'human'),
    ).toThrow('revision body cannot be empty')
  })

  it('getLatestRevision returns null when no revisions exist', () => {
    const proposal = createProposal(dataDir, 'thread-1', {})
    expect(getLatestRevision(dataDir, 'thread-1', proposal.id)).toBeNull()
  })

  it('getLatestRevision returns the most recent revision body', () => {
    const proposal = createProposal(dataDir, 'thread-1', {})
    addProposalRevision(dataDir, 'thread-1', proposal.id, 'first draft', 'human')
    addProposalRevision(dataDir, 'thread-1', proposal.id, 'second draft', 'claude')
    expect(getLatestRevision(dataDir, 'thread-1', proposal.id)).toBe('second draft')
  })

  it('falls back for legacy proposals without latest revision pointers', () => {
    const proposal = createProposal(dataDir, 'thread-1', {})
    addProposalRevision(dataDir, 'thread-1', proposal.id, 'first draft', 'human')
    const stored = JSON.parse(fs.readFileSync(proposalJsonPath(dataDir, 'thread-1', proposal.id), 'utf8')) as {
      latest_revision_id?: string | null
    }
    delete stored.latest_revision_id
    fs.writeFileSync(
      proposalJsonPath(dataDir, 'thread-1', proposal.id),
      JSON.stringify(stored, null, 2),
    )

    expect(getLatestRevision(dataDir, 'thread-1', proposal.id)).toBe('first draft')
  })

  it('listRevisions returns metadata in creation order', () => {
    const proposal = createProposal(dataDir, 'thread-1', {})
    addProposalRevision(dataDir, 'thread-1', proposal.id, 'first draft', 'human')
    addProposalRevision(dataDir, 'thread-1', proposal.id, 'second draft', 'claude')
    const revisions = listRevisions(dataDir, 'thread-1', proposal.id)
    expect(revisions).toHaveLength(2)
    expect(revisions[0].author).toBe('human')
    expect(revisions[1].author).toBe('claude')
  })

  it('throws NotFoundError when adding a revision to a missing proposal', () => {
    expect(() =>
      addProposalRevision(
        dataDir,
        'thread-1',
        'consolidation-999',
        'body',
        'human',
      ),
    ).toThrow(NotFoundError)
  })
})
