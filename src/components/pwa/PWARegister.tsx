'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker in production builds only. In development
 * the SW is explicitly unregistered so stale caches never mask code
 * changes during local work.
 */
export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* PWA is progressive enhancement; registration failure is silent */
      })
    } else if (window.location.protocol === 'https:') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister())
      })
    }
  }, [])

  return null
}
