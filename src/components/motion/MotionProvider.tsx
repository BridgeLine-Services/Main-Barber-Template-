'use client'

// Wraps the customer-facing tree in framer-motion's global config.
// `reducedMotion="user"` makes EVERY motion primitive in the app respect the
// OS-level "reduce motion" preference automatically: transform animations are
// skipped and elements appear at rest, without any per-component code.
import { MotionConfig } from 'framer-motion'

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
