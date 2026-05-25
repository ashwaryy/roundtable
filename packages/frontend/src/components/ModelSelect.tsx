import { useEffect, useState } from 'react'
import type { AgentRuntime } from '@roundtable/shared'

const CUSTOM_VALUE = '__other__'

const MODELS: Record<AgentRuntime, string[]> = {
  claude: [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  codex: [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
  ],
}

export function ModelSelect({
  runtime,
  value,
  onChange,
  onCommit,
  className = 'input',
  disabled = false,
  ariaLabel = 'Model',
}: {
  runtime: AgentRuntime
  value: string
  onChange: (value: string) => void
  onCommit?: (value: string) => void
  className?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const choices = MODELS[runtime]
  const isCustomValue = value !== '' && !choices.includes(value)
  const [customMode, setCustomMode] = useState(isCustomValue)

  useEffect(() => {
    if (isCustomValue) setCustomMode(true)
    if (value && choices.includes(value)) setCustomMode(false)
  }, [choices, isCustomValue, value])

  const selection = customMode || isCustomValue
    ? CUSTOM_VALUE
    : value

  return (
    <div className="model-select">
      <select
        className={className}
        aria-label={ariaLabel}
        value={selection}
        disabled={disabled}
        onChange={(event) => {
          const selected = event.target.value
          if (selected === CUSTOM_VALUE) {
            setCustomMode(true)
            onChange('')
          } else {
            setCustomMode(false)
            onChange(selected)
            onCommit?.(selected)
          }
        }}
      >
        <option value="">CLI default</option>
        {choices.map((model) => <option key={model} value={model}>{model}</option>)}
        <option value={CUSTOM_VALUE}>Other</option>
      </select>
      {customMode || isCustomValue ? (
        <input
          className={className}
          aria-label={`${ariaLabel} custom value`}
          placeholder="Custom model"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => onCommit?.(value)}
        />
      ) : null}
    </div>
  )
}
