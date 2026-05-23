import express from 'express'
import {
  createThreadInputSchema,
  createCommentInputSchema,
  createPendingDiscussionInputSchema,
  editPendingDiscussionInputSchema,
  type RoundtableEvent,
} from '@roundtable/shared'
import { NotFoundError, type Storage } from './storage'

const THREAD_ID_RE = /^thread-\d+$/
const PENDING_ID_RE = /^pd\d+$/

export function createApp(deps: {
  storage: Storage
  broadcast: (event: RoundtableEvent) => void
}): express.Express {
  const { storage, broadcast } = deps
  const app = express()
  app.use(express.json())

  app.param('id', (_req, res, next, value: string) => {
    if (!THREAD_ID_RE.test(value)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    next()
  })

  app.param('pendingId', (_req, res, next, value: string) => {
    if (!PENDING_ID_RE.test(value)) {
      return res.status(404).json({ error: 'pending discussion not found' })
    }
    next()
  })

  app.post('/api/threads', (req, res) => {
    const parsed = createThreadInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }
    const thread = storage.createThread(parsed.data)
    broadcast({ type: 'thread_created', thread_id: thread.id })
    res.status(201).json(thread)
  })

  app.get('/api/threads', (_req, res) => {
    res.json(storage.listThreads())
  })

  app.get('/api/threads/:id', (req, res) => {
    const thread = storage.getThread(req.params.id)
    if (!thread) return res.status(404).json({ error: 'thread not found' })
    res.json(thread)
  })

  app.get('/api/threads/:id/comments', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    res.json(storage.listComments(req.params.id))
  })

  app.post('/api/threads/:id/comments', (req, res) => {
    const parsed = createCommentInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }
    try {
      const comment = storage.addComment(req.params.id, parsed.data)
      broadcast({ type: 'comment_created', thread_id: req.params.id })
      res.status(201).json(comment)
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  app.get('/api/threads/:id/pending-discussions', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    res.json(storage.listPendingDiscussions(req.params.id))
  })

  app.post('/api/threads/:id/pending-discussions', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }

    const parsed = createPendingDiscussionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const discussion = storage.addPendingDiscussion(req.params.id, parsed.data)
      broadcast({ type: 'pending_discussion_created', thread_id: req.params.id })
      res.status(201).json(discussion)
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  app.post(
    '/api/threads/:id/pending-discussions/:pendingId/approve',
    (req, res) => {
      if (!storage.getThread(req.params.id)) {
        return res.status(404).json({ error: 'thread not found' })
      }

      try {
        const comment = storage.approvePendingDiscussion(
          req.params.id,
          req.params.pendingId,
        )
        broadcast({
          type: 'pending_discussion_updated',
          thread_id: req.params.id,
        })
        broadcast({ type: 'comment_created', thread_id: req.params.id })
        res.status(201).json(comment)
      } catch (err) {
        if (err instanceof NotFoundError) {
          return res.status(404).json({ error: err.message })
        }
        throw err
      }
    },
  )

  app.patch('/api/threads/:id/pending-discussions/:pendingId', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }

    const parsed = editPendingDiscussionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const updated = storage.editPendingDiscussion(
        req.params.id,
        req.params.pendingId,
        parsed.data,
      )
      broadcast({
        type: 'pending_discussion_updated',
        thread_id: req.params.id,
      })
      res.status(200).json(updated)
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  app.delete('/api/threads/:id/pending-discussions/:pendingId', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }

    try {
      storage.rejectPendingDiscussion(req.params.id, req.params.pendingId)
      broadcast({
        type: 'pending_discussion_updated',
        thread_id: req.params.id,
      })
      res.status(204).send()
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  return app
}
