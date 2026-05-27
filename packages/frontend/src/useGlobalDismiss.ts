import { useEffect, useRef } from 'react'

type DismissOptions = {
  escape?: boolean
  pointerDown?: boolean
}

export function useGlobalDismiss(active: boolean, onDismiss: () => void, options: DismissOptions = {}) {
  const { escape = false, pointerDown = false } = options
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!active) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismissRef.current()
    }

    function onPointerDown() {
      onDismissRef.current()
    }

    if (escape) window.addEventListener('keydown', onKeyDown)
    if (pointerDown) window.addEventListener('pointerdown', onPointerDown)

    return () => {
      if (escape) window.removeEventListener('keydown', onKeyDown)
      if (pointerDown) window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [active, escape, pointerDown])
}
