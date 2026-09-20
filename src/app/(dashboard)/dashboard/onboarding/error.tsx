'use client'

import { useEffect } from 'react'

export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[onboarding] page render failed:', error)
  }, [error])

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">Setup is temporarily unavailable</h2>
        <p className="mt-2 text-sm text-zinc-300">
          We couldn&apos;t render your onboarding workspace. Your account is safe. Please try again.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
