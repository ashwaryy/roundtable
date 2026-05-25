import { z } from 'zod'

export const commentTypeSchema = z.enum([
  'comment',
  'proposal',
  'critique',
  'question',
  'decision',
])

export const commentAuthorSchema = z.enum(['human', 'claude', 'codex', 'system'])

export const agentNameSchema = z.enum(['claude', 'codex'])

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

export const createUrlContextInputSchema = z.object({
  url: z.string().trim().url('url must be valid'),
  label: z.string().trim().min(1).nullish(),
})

export const snapshotPreflightInputSchema = z.object({
  source_path: z.string().trim().min(1, 'source_path is required'),
})

export const createProjectSnapshotInputSchema = z.object({
  source_path: z.string().trim().min(1, 'source_path is required'),
  confirmed: z.boolean().optional(),
})

const nullableTrimmedModelSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).nullable().optional(),
)

export const startRoomInputSchema = z.object({
  claude_model: nullableTrimmedModelSchema,
  codex_model: nullableTrimmedModelSchema,
})

export const nudgeRoomInputSchema = z.object({
  agent: agentNameSchema,
  body: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    )
    .nullable()
    .optional(),
})

export const readyInputSchema = z.object({
  agent: agentNameSchema,
})

export const askAgentInputSchema = z.object({
  agent: agentNameSchema,
  body: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    )
    .nullable()
    .optional(),
  discussion_id: z.string().min(1).nullish(),
})

const autoTurnCountSchema = z.coerce
  .number()
  .int()
  .min(1, 'turn_count must be at least 1')
  .max(20, 'turn_count must be at most 20')

export const startAutoDiscussionInputSchema = z.object({
  turn_count: autoTurnCountSchema,
  allow_direct_roots: z.boolean().optional(),
})

export const extendAutoDiscussionInputSchema = z.object({
  turn_count: autoTurnCountSchema,
})

export const sendRoomInputResponseInputSchema = z.object({
  agent: agentNameSchema,
  response: z.enum(['yes', 'no']),
})

export const helperCommentInputSchema = z.object({
  turn_id: z.string().min(1, 'turn_id is required'),
  agent: agentNameSchema,
  body: z.string().trim().min(1, 'body is required'),
  type: commentTypeSchema.optional(),
  discussion_id: z.string().min(1).nullish(),
})

export const helperPendingDiscussionInputSchema = z.object({
  turn_id: z.string().min(1, 'turn_id is required'),
  agent: agentNameSchema,
  body: z.string().trim().min(1, 'body is required'),
  type: commentTypeSchema.optional(),
  origin_discussion_id: z.string().min(1).nullish(),
  origin_comment_id: z.string().min(1).nullish(),
  continue_turn: z.boolean().optional(),
})

export const startConsolidationInputSchema = z.object({
  summary: z.string().trim().min(1).nullish(),
  instructions: z.string().trim().min(1).nullish(),
  drafter_agent: agentNameSchema.optional(),
  reviewer_agent: agentNameSchema.optional(),
  reviser_agent: agentNameSchema.optional(),
})

export const createProposalRevisionInputSchema = z.object({
  body: z.string().trim().min(1, 'body is required'),
})

export const requestProposalReviewInputSchema = z.object({
  instructions: z.string().trim().min(1).nullish(),
  reviewer_agent: agentNameSchema.optional(),
})

export const requestProposalRevisionInputSchema = z.object({
  instructions: z.string().trim().min(1).nullish(),
  reviewer_agent: agentNameSchema.optional(),
  reviser_agent: agentNameSchema.optional(),
})

export const helperProposalInputSchema = z.object({
  turn_id: z.string().min(1, 'turn_id is required'),
  agent: agentNameSchema,
  body: z.string().trim().min(1, 'body is required'),
})

export const helperReviewInputSchema = z.object({
  turn_id: z.string().min(1, 'turn_id is required'),
  agent: agentNameSchema,
  body: z.string().trim().min(1, 'body is required'),
})
