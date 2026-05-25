export function NewCommentsPill({
  count,
  latestNewId,
  onDismiss,
}: {
  count: number
  latestNewId: string | null
  onDismiss: () => void
}) {
  if (count === 0) return null

  function handleClick() {
    if (latestNewId) {
      const el = document.getElementById(latestNewId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        // Move focus to the jumped-to comment for keyboard users.
        if (el.tabIndex < 0) el.tabIndex = -1
        el.focus({ preventScroll: true })
        // Apply highlight animation so the landing point is obvious.
        el.classList.add('comment-bubble--new')
        el.addEventListener('animationend', () => el.classList.remove('comment-bubble--new'), { once: true })
      }
    }
    onDismiss()
  }

  const label = `${count} new comment${count === 1 ? '' : 's'} — click to jump to latest`

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="new-comments-pill-wrapper">
      <button
        className="new-comments-pill"
        type="button"
        onClick={handleClick}
        aria-label={label}
      >
        ↓ {count} new
      </button>
    </div>
  )
}
