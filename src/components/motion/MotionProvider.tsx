'use client'

// Wraps the customer-facing tree in framer-motion's global config and
// enforces the tenant's chosen motion level site-wide.
//
// Two layers of motion control, in priority order:
//  1. `reducedMotion="user"` — the OS-level "reduce motion" preference
//     always wins: transforms are dropped and elements appear at rest.
//  2. The owner's published motion level (off / subtle / expressive):
//     - off       → entrance animations are disabled entirely; all content
//                   renders statically and immediately visible.
//     - subtle    → opacity-only fades with a minimal y-drift; no directional
//                   slides, no looping indicators.
//     - expressive → the full animation language (default).
import { createContext, useContext } from 'react'
import { MotionConfig } from 'framer-motion'
import type { MotionLevel } from '@/lib/visual-config'

const MotionLevelContext = createContext<MotionLevel>('expressive')

export function useMotionLevel(): MotionLevel {
  return useContext(MotionLevelContext)
}

export function MotionProvider({
  children,
  level = 'expressive',
}: {
  children: React.ReactNode
  level?: MotionLevel
}) {
  return (
    <MotionLevelContext.Provider value={level}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </MotionLevelContext.Provider>
  )
}
