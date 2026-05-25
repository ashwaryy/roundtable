export const RAIL_COLLAPSED_STORAGE_KEY = 'roundtable.threadRailCollapsed'

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key)
    if (value == null) return fallback
    return value === '1'
  } catch {
    return fallback
  }
}

export function writeStoredBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Ignore storage failures; the UI state still works for this session.
  }
}
