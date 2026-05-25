import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ThreadContext } from '@roundtable/shared'
import { ThreadContextPanel } from './ThreadContextPanel'
import * as api from '../api'

vi.mock('../api')

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

function makeContext(): ThreadContext {
  return {
    items: [
      {
        id: 'ctx001',
        thread_id: 'thread-1',
        kind: 'url',
        url: 'https://example.com/spec',
        label: 'Spec',
        created_at: '2026-05-23T00:00:00Z',
      },
    ],
    snapshot: {
      source_path: '/tmp/project',
      mode: 'git-tracked',
      created_at: '2026-05-23T00:00:00Z',
      refreshed_at: '2026-05-23T00:00:00Z',
      file_count: 2,
      total_bytes: 2048,
      warnings: [],
      added_since_last_refresh: ['src/new.ts'],
      latest_report_id: 'snapshot-001',
    },
    workspace_added_files: [
      {
        path: 'manual.md',
        size_bytes: 8,
        modified_at: '2026-05-23T00:00:00Z',
      },
    ],
  }
}

describe('ThreadContextPanel', () => {
  it('renders context items, snapshot status, and added files', () => {
    render(
      <ThreadContextPanel
        threadId="thread-1"
        context={makeContext()}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.getByText(/Spec/)).toBeInTheDocument()
    expect(screen.getByText(/Latest: git-tracked, 2 files/)).toBeInTheDocument()
    expect(screen.getByText('src/new.ts')).toBeInTheDocument()
    expect(screen.getByText(/manual.md/)).toBeInTheDocument()
  })

  it('uploads selected files and refreshes context', async () => {
    const onUpdate = vi.fn()
    mockedApi.uploadAttachmentFiles.mockResolvedValue([])
    render(
      <ThreadContextPanel threadId="thread-1" context={null} onUpdate={onUpdate} />,
    )

    const input = screen.getByLabelText(/add files/i)
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await userEvent.upload(input, file)

    expect(mockedApi.uploadAttachmentFiles).toHaveBeenCalledWith(
      'thread-1',
      expect.any(FileList),
    )
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('adds URL context items', async () => {
    const onUpdate = vi.fn()
    mockedApi.addUrlContextItem.mockResolvedValue({
      id: 'ctx001',
      thread_id: 'thread-1',
      kind: 'url',
      url: 'https://example.com',
      label: null,
      created_at: '2026-05-23T00:00:00Z',
    })
    render(
      <ThreadContextPanel threadId="thread-1" context={null} onUpdate={onUpdate} />,
    )

    await userEvent.type(screen.getByLabelText('URL'), 'https://example.com')
    await userEvent.click(screen.getByRole('button', { name: /add url/i }))

    expect(mockedApi.addUrlContextItem).toHaveBeenCalledWith('thread-1', {
      url: 'https://example.com',
      label: null,
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('preflights and creates a confirmed snapshot', async () => {
    const onUpdate = vi.fn()
    mockedApi.preflightProjectSnapshot.mockResolvedValue({
      source_path: '/tmp/project',
      mode: 'folder',
      requires_confirmation: true,
      file_count: 1,
      total_bytes: 10,
      excluded_count: 0,
      warnings: [],
    })
    mockedApi.createProjectSnapshot.mockResolvedValue({
      source_path: '/tmp/project',
      mode: 'folder',
      created_at: '2026-05-23T00:00:00Z',
      refreshed_at: '2026-05-23T00:00:00Z',
      file_count: 1,
      total_bytes: 10,
      warnings: [],
      added_since_last_refresh: ['notes.md'],
      latest_report_id: 'snapshot-001',
    })
    render(
      <ThreadContextPanel threadId="thread-1" context={null} onUpdate={onUpdate} />,
    )

    await userEvent.type(screen.getByLabelText(/project path/i), '/tmp/project')
    await userEvent.click(screen.getByRole('button', { name: /check snapshot/i }))
    expect(await screen.findByText(/folder snapshot: 1 files/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /confirm snapshot/i }))
    expect(mockedApi.createProjectSnapshot).toHaveBeenCalledWith('thread-1', {
      source_path: '/tmp/project',
      confirmed: true,
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('refreshes an existing snapshot', async () => {
    const onUpdate = vi.fn()
    mockedApi.refreshProjectSnapshot.mockResolvedValue(makeContext().snapshot!)
    render(
      <ThreadContextPanel
        threadId="thread-1"
        context={makeContext()}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /refresh snapshot/i }))
    expect(mockedApi.refreshProjectSnapshot).toHaveBeenCalledWith('thread-1')
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })
})
