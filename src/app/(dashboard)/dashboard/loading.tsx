import React from 'react'

// Loading boundary for /dashboard pages. Deliberately nested BELOW the
// dashboard layout's server-side access gate (src/lib/onboarding.ts) so the
// gate's redirect() (login / /change-password / onboarding) always emits a
// real HTTP redirect — a loading.tsx at or above the gate would flush a
// 200 shell first and demote the gate to a client-side-only redirect.
export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--dash-surface)] flex flex-col items-center justify-center space-y-4">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-4 border-[var(--dash-brand-border)]"></div>
        <div className="absolute inset-0 rounded-full border-4 border-amber-400 border-t-transparent animate-spin"></div>
      </div>
      <p className="text-muted-foreground font-medium text-sm animate-pulse tracking-wide font-poppins">
        Loading...
      </p>
    </div>
  )
}
