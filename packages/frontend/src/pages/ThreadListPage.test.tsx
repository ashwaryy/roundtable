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

describe('ThreadListPage', () => {
  it('renders existing threads', async () => {
    mockedApi.listThreads.mockResolvedValue([
      {
        id: 'thread-1',
        title: 'Queue work',
        status: 'open',
        parent_thread_id: null,
        created_from_consolidation_id: null,
        created_at: '2026-05-23T00:00:00Z',
        archived_at: null,
        closed_at: null,
      },
    ])
    renderPage()
    expect(await screen.findByText('Queue work')).toBeInTheDocument()
  })

  it('creates a thread from the form and shows it', async () => {
    const created = {
      id: 'thread-1',
      title: 'New idea',
      status: 'open' as const,
      parent_thread_id: null,
      created_from_consolidation_id: null,
      created_at: '2026-05-23T00:00:00Z',
      archived_at: null,
      closed_at: null,
    }
    mockedApi.listThreads.mockResolvedValueOnce([]).mockResolvedValue([created])
    mockedApi.createThread.mockResolvedValue(created)

    renderPage()
    await userEvent.type(screen.getByLabelText('title'), 'New idea')
    await userEvent.type(screen.getByLabelText('body'), 'some body')
    await userEvent.click(screen.getByRole('button', { name: 'Create thread' }))

    await waitFor(() => expect(mockedApi.createThread).toHaveBeenCalled())
    expect(await screen.findByText('New idea')).toBeInTheDocument()
  })
})
