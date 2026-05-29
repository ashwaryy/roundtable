export const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort
}
