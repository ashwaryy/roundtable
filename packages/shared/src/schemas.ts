import { z } from 'zod'
import { isAllowedRuntimeEffort } from './runtimeConfig'

export const commentTypeSchema = z.enum([
  'comment',
  'proposal',
  'critique',
  'question',
  'decision',
])

export const agentIdSchema = z.string().trim().min(1)
export const agentRuntimeSchema = z.enum(['claude', 'codex'])
export const agentColorPresetSchema = z.enum([
  'blue',
  'green',
  'amber',
  'rose',
  'violet',
  'teal',
])
export const commentAuthorSchema = z.string().trim().min(1)

export const agentNameSchema = agentIdSchema

const nullableTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).nullable().optional(),
)

function runtimeEffortValid(data: { runtime: 'claude' | 'codex'; effort?: string | null }): boolean {
  if (data.effort == null) return true
  return isAllowedRuntimeEffort(data.runtime, data.effort)
}

export const createAgentInputSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  runtime: agentRuntimeSchema,
  role_description: z.string().trim().default(''),
  instructions: z.string().default(''),
  model: nullableTrimmedStringSchema,
  effort: nullableTrimmedStringSchema,
  color: agentColorPresetSchema.default('blue'),
  logo_url: z.string().trim().url('logo_url must be valid').nullable().optional(),
}).refine(runtimeEffortValid, { path: ['effort'], message: 'effort is not valid for runtime' })

export const updateAgentInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  runtime: agentRuntimeSchema.optional(),
  role_description: z.string().trim().optional(),
  instructions: z.string().optional(),
  model: nullableTrimmedStringSchema,
  effort: nullableTrimmedStringSchema,
  color: agentColorPresetSchema.optional(),
  logo_url: z.string().trim().url('logo_url must be valid').nullable().optional(),
  archived: z.boolean().optional(),
})

export const importAgentsInputSchema = z.union([
  createAgentInputSchema,
  z.array(createAgentInputSchema).min(1).max(50),
])

export const createThreadInputSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  body: z.string().min(1, 'body is required'),
  agent_ids: z.array(agentIdSchema).min(1).max(8).optional(),
})

export const inviteAgentInputSchema = z.object({
  agent_id: agentIdSchema,
  model: nullableTrimmedStringSchema,
  effort: nullableTrimmedStringSchema,
})

export const updateThreadAgentInviteInputSchema = z.object({
  model: nullableTrimmedStringSchema,
  effort: nullableTrimmedStringSchema,
}).refine((value) => value.model !== undefined || value.effort !== undefined, {
  message: 'at least one override is required',
})

export const reorderThreadAgentsInputSchema = z.object({
  agent_ids: z.array(agentIdSchema).min(1).max(8),
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
  resume: z.boolean().optional(),
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

export const requestIdleSuggestionInputSchema = z.object({
  agent: agentNameSchema,
  body: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    )
    .nullable()
    .optional(),
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

export const tmuxPaneInputKeySchema = z.enum([
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'CtrlC',
  'CtrlD',
  'CtrlL',
  'CtrlU',
])

export const tmuxPaneInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('key'),
    key: tmuxPaneInputKeySchema,
  }),
  z.object({
    type: z.literal('text'),
    text: z.string().min(1, 'text is required').max(500, 'text must be at most 500 characters'),
  }),
])

export const helperCommentInputSchema = z.object({
  turn_id: z.string().min(1, 'turn_id is required'),
  agent: agentNameSchema,
  body: z.string().trim().min(1, 'body is required'),
  type: commentTypeSchema.optional(),
  discussion_id: z.string().min(1).nullish(),
})

export const helperPendingDiscussionInputSchema = z.object({
  turn_id: z.string().min(1, 'turn_id is required').optional(),
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
