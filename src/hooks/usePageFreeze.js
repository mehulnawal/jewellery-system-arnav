import { useEffect } from 'react'
let lockCount = 0
let previousHtmlOverflow = ''
let previousBodyOverflow = ''
export function usePageFreeze(active = true) {
  useEffect(() => {
    if (!active) return undefined
    if (lockCount === 0) {
      previousHtmlOverflow = document.documentElement.style.overflow
      previousBodyOverflow = document.body.style.overflow
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
    }
    lockCount += 1
    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) {
        document.documentElement.style.overflow = previousHtmlOverflow
        document.body.style.overflow = previousBodyOverflow
      }
    }
  }, [active])
}