import { z } from 'zod'

export const commentTypeSchema = z.enum([
  'comment',
  'proposal',
  'critique',
  'question',
  'decision',
])

export const createThreadInputSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  body: z.string().min(1, 'body is required'),
})

export const createCommentInputSchema = z.object({
  body: z.string().trim().min(1, 'body is required'),
  type: commentTypeSchema.optional(),
  reply_to: z.string().min(1).nullish(),
})
