import { useEffect, useState } from 'react'
import { Icon } from './primitives'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'rt:theme'

function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Apply the persisted theme to <html> before first paint (called from main.tsx). */
export function applyStoredTheme(): void {
  document.documentElement.setAttribute('data-theme', readTheme())
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => readTheme() === 'dark')

  useEffect(() => {
    const theme: Theme = dark ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {}
  }, [dark])

  return (
    <button
      type="button"
      className="btn ghost icon"
      onClick={() => setDark((v) => !v)}
      title="Toggle theme"
      aria-label="Toggle theme"
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  )
}
