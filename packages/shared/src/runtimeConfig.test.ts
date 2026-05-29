import { describe, expect, it } from 'vitest'
import {
  allowedEffortsForRuntime,
  isAllowedRuntimeEffort,
  runtimeConfigs,
  suggestedModelsForRuntime,
} from './runtimeConfig'

describe('runtimeConfig', () => {
  it('exposes suggested models for picker UIs', () => {
    expect(runtimeConfigs.claude.suggestedModels).toContain('claude-opus-4-8')
    expect(suggestedModelsForRuntime('codex')).toContain('gpt-5.5')
  })

  it('exposes asymmetric allowed efforts per runtime', () => {
    expect(allowedEffortsForRuntime('claude')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(allowedEffortsForRuntime('codex')).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('validates runtime effort membership', () => {
    expect(isAllowedRuntimeEffort('claude', 'max')).toBe(true)
    expect(isAllowedRuntimeEffort('claude', 'xhigh')).toBe(true)
    expect(isAllowedRuntimeEffort('codex', 'xhigh')).toBe(true)
    expect(isAllowedRuntimeEffort('codex', 'max')).toBe(false)
    expect(isAllowedRuntimeEffort('claude', 'bogus')).toBe(false)
    expect(isAllowedRuntimeEffort('claude', null)).toBe(false)
  })
})
