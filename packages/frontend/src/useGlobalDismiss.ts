import { useEffect } from 'react'

type DismissOptions = {
  escape?: boolean
  pointerDown?: boolean
}

export function useGlobalDismiss(active: boolean, onDismiss: () => void, options: DismissOptions = {}) {
  const { escape = false, pointerDown = false } = options

  useEffect(() => {
    if (!active) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }

    function onPointerDown() {
      onDismiss()
    }

    if (escape) window.addEventListener('keydown', onKeyDown)
    if (pointerDown) window.addEventListener('pointerdown', onPointerDown)

    return () => {
      if (escape) window.removeEventListener('keydown', onKeyDown)
      if (pointerDown) window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [active, escape, onDismiss, pointerDown])
}
