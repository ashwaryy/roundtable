import { useEffect, useState } from 'react'
import { readStoredBoolean, writeStoredBoolean } from './lib/uiStorage'

export function useStoredBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => readStoredBoolean(key, fallback))

  useEffect(() => {
    writeStoredBoolean(key, value)
  }, [key, value])

  return [value, setValue] as const
}
