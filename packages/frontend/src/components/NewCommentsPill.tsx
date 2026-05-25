export function NewCommentsPill({
  count,
  firstNewId,
  onDismiss,
}: {
  count: number
  firstNewId: string | null
  onDismiss: () => void
}) {
  if (count === 0) return null

  function handleClick() {
    if (firstNewId) {
      const el = document.getElementById(firstNewId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        // Move focus to the first new comment element
        if (el.tabIndex < 0) el.tabIndex = -1
        el.focus({ preventScroll: true })
        // Apply highlight animation
        el.classList.add('comment-bubble--new')
        el.addEventListener('animationend', () => el.classList.remove('comment-bubble--new'), { once: true })
      }
    }
    onDismiss()
  }

  const label = `${count} new comment${count === 1 ? '' : 's'} — click to jump`

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
