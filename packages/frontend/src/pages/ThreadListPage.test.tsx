import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThreadListPage } from './ThreadListPage'
import * as api from '../api'

vi.mock('../api')
vi.mock('../useLiveRefresh', () => ({ useLiveRefresh: () => {} }))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ThreadListPage />
    </MemoryRouter>,
  )
}

function threadListItem(title: string) {
  return {
    id: 'thread-1',
    title,
    status: 'open' as const,
    parent_thread_id: null,
    created_from_consolidation_id: null,
    created_at: '2026-05-23T00:00:00Z',
    archived_at: null,
    closed_at: null,
    display_status: 'setup' as const,
    pending_count: 0,
    recovery_action_label: null,
  }
}

describe('ThreadListPage', () => {
  it('renders existing threads', async () => {
    mockedApi.listThreads.mockResolvedValue([threadListItem('Queue work')])
    renderPage()
    expect(await screen.findByText('Queue work')).toBeInTheDocument()
  })

  it('creates a thread from the form and shows it', async () => {
    const created = threadListItem('New idea')
    mockedApi.listThreads.mockResolvedValueOnce([]).mockResolvedValue([created])
    mockedApi.createThread.mockResolvedValue(created)
    mockedApi.getThreadContext.mockResolvedValue({
      items: [],
      snapshot: null,
      workspace_added_files: [],
    })
    mockedApi.listSnapshotReports.mockResolvedValue([])

    renderPage()
    await userEvent.type(screen.getByLabelText('title'), 'New idea')
    await userEvent.type(screen.getByLabelText('body'), 'some body')
    await userEvent.click(screen.getByRole('button', { name: 'Create thread' }))

    await waitFor(() => expect(mockedApi.createThread).toHaveBeenCalled())
    expect(await screen.findByText('New idea')).toBeInTheDocument()
  })
})
