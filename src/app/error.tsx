'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled runtime error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6 bg-card border border-border p-8 rounded-lg">
        <div className="mx-auto w-16 h-16 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center justify-center text-destructive">
          <AlertTriangle className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <p className="eyebrow text-destructive">Application Error</p>
          <h1 className="display-heading text-display-2 text-foreground">Something went wrong</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            An unexpected error occurred while loading this page. Please try again or return to the homepage.
          </p>
        </div>

        {error.digest && (
          <div className="bg-muted p-2 rounded-md border border-border font-mono text-xs text-muted-foreground">
            Digest: {error.digest}
          </div>
        )}

        <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-colors duration-micro focus-ring"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border font-medium text-sm transition-colors duration-micro focus-ring"
          >
            <Home className="w-4 h-4 mr-2" />
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
