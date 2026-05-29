import { useEffect, useState } from 'react'
import { suggestedModelsForRuntime, type AgentRuntime } from '@roundtable/shared'

const CUSTOM_VALUE = '__other__'

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
  const choices = suggestedModelsForRuntime(runtime)
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
