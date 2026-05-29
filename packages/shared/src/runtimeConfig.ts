export type RuntimeName = 'claude' | 'codex'

export const runtimeConfigs = {
  claude: {
    suggestedModels: [
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ],
    allowedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    cliFlag: '--effort',
    notes: 'Claude CLI accepts effort directly.',
  },
  codex: {
    suggestedModels: [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
    ],
    allowedEfforts: ['low', 'medium', 'high', 'xhigh'],
    cliFlag: 'model_reasoning_effort',
    notes: 'Codex CLI receives effort through -c model_reasoning_effort.',
  },
} as const

export type RuntimeConfig = (typeof runtimeConfigs)[RuntimeName]
export type RuntimeEffort = RuntimeConfig['allowedEfforts'][number]

export function suggestedModelsForRuntime(runtime: RuntimeName): string[] {
  return [...runtimeConfigs[runtime].suggestedModels]
}

export function allowedEffortsForRuntime(runtime: RuntimeName): RuntimeEffort[] {
  return [...runtimeConfigs[runtime].allowedEfforts]
}

export function isAllowedRuntimeEffort(
  runtime: RuntimeName,
  effort: string | null | undefined,
): effort is RuntimeEffort {
  if (typeof effort !== 'string') return false
  return (runtimeConfigs[runtime].allowedEfforts as readonly string[]).includes(effort)
}
