export type RoundtableEvent =
  | { type: 'thread_created'; thread_id: string }
  | { type: 'comment_created'; thread_id: string }
  | { type: 'pending_discussion_created'; thread_id: string }
  | { type: 'pending_discussion_updated'; thread_id: string }
  | { type: 'thread_context_updated'; thread_id: string }
  | { type: 'room_updated'; thread_id: string }
  | { type: 'job_updated'; thread_id: string; job_id: string }
