import { describe, expect, it } from 'vitest'
import { cliCommand, invalidRuntimeEffortWarning, resumeCliCommand } from './runtime-config'

describe('runtime launch commands', () => {
  it('passes allowed efforts and model strings through unchanged', () => {
    const claude = cliCommand('claude', 'custom-claude-model', 'max', '.roundtable/claude-startup.md')
    const codex = resumeCliCommand('codex', 'my-codex-model', 'xhigh', '.roundtable/codex-startup.md')

    expect(claude).toContain("--model 'custom-claude-model'")
    expect(claude).toContain("--effort 'max'")
    expect(codex).toContain("--model 'my-codex-model'")
    expect(codex).toContain(`model_reasoning_effort="xhigh"`)
  })

  it('omits invalid stale effort values and emits a warning message', () => {
    const claude = cliCommand('claude', 'custom-claude-model', 'bogus', '.roundtable/claude-startup.md')
    const codex = resumeCliCommand('codex', 'my-codex-model', 'max', '.roundtable/codex-startup.md')

    expect(claude).not.toContain('--effort')
    expect(codex).not.toContain('model_reasoning_effort=')
    expect(invalidRuntimeEffortWarning('claude', 'bogus')).toBe(
      'Roundtable warning: omitted unsupported claude effort bogus; CLI default will apply.',
    )
    expect(invalidRuntimeEffortWarning('codex', 'max')).toBe(
      'Roundtable warning: omitted unsupported codex effort max; CLI default will apply.',
    )
  })
})
