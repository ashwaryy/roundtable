import { useEffect, useRef, useState } from 'react'
import type { Comment } from '@roundtable/shared'

export function useNewCommentTracking(mainRef: React.RefObject<HTMLDivElement>, comments: Comment[], commentsLoaded: boolean, bottomThresholdPx = 24) {
  const [isAtBottom, setIsAtBottom] = useState(true)
  const prevCommentIdsRef = useRef<Set<string>>(new Set())
  const [newCommentCount, setNewCommentCount] = useState(0)
  const [latestNewCommentId, setLatestNewCommentId] = useState<string | null>(null)

  useEffect(() => {
    const node = mainRef.current
    if (!node) return

    function onScroll() {
      const current = mainRef.current
      if (!current) return
      const atBottom = current.scrollHeight - current.scrollTop - current.clientHeight <= bottomThresholdPx
      setIsAtBottom(atBottom)
      if (atBottom) {
        setNewCommentCount(0)
        setLatestNewCommentId(null)
      }
    }

    onScroll()
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [bottomThresholdPx, mainRef])

  useEffect(() => {
    if (!commentsLoaded) return
    const el = mainRef.current
    const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight <= bottomThresholdPx : isAtBottom
    setIsAtBottom(atBottom)

    const prev = prevCommentIdsRef.current
    const newOnes = comments.filter((comment) => !prev.has(comment.id))
    if (atBottom) {
      setNewCommentCount(0)
      setLatestNewCommentId(null)
    } else if (prev.size > 0 && newOnes.length > 0) {
      setNewCommentCount((count) => count + newOnes.length)
      setLatestNewCommentId(newOnes[newOnes.length - 1]?.id ?? null)
    }

    prevCommentIdsRef.current = new Set(comments.map((comment) => comment.id))
  }, [bottomThresholdPx, comments, commentsLoaded, isAtBottom, mainRef])

  return {
    newCommentCount,
    latestNewCommentId,
    dismissNewComments: () => {
      setNewCommentCount(0)
      setLatestNewCommentId(null)
    },
  }
}
