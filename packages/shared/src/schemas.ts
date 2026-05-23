import { z } from 'zod'

export const commentTypeSchema = z.enum([
  'comment',
  'proposal',
  'critique',
  'question',
  'decision',
])

export const commentAuthorSchema = z.enum(['human', 'claude', 'codex', 'system'])

export const createThreadInputSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  body: z.string().min(1, 'body is required'),
})

export const createCommentInputSchema = z.object({
  body: z.string().trim().min(1, 'body is required'),
  type: commentTypeSchema.optional(),
  reply_to: z.string().min(1).nullish(),
})

export const createPendingDiscussionInputSchema = z.object({
  author: commentAuthorSchema,
  type: commentTypeSchema.optional(),
  body: z.string().trim().min(1, 'body is required'),
  origin_discussion_id: z.string().min(1).nullish(),
  origin_comment_id: z.string().min(1).nullish(),
})

export const editPendingDiscussionInputSchema = z
  .object({
    body: z.string().trim().min(1).optional(),
    type: commentTypeSchema.optional(),
  })
  .refine(
    (d) => d.body !== undefined || d.type !== undefined,
    'at least one of body or type is required',
  )
