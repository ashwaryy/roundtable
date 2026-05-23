export type RoundtableEvent =
  | { type: 'thread_created'; thread_id: string }
  | { type: 'comment_created'; thread_id: string }
