import React from 'react'
import Link from 'next/link'
import { Scissors, Home, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6 bg-card border border-border p-8 rounded-lg">
        <div className="mx-auto w-16 h-16 bg-primary/10 border border-primary/30 rounded-lg flex items-center justify-center text-primary">
          <Scissors className="w-8 h-8 rotate-90" />
        </div>

        <div className="space-y-2">
          <p className="eyebrow-accent">404 Error</p>
          <h1 className="display-heading text-display-2 text-foreground">Page Not Found</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {"Looks like this cut went off the lines. The page you are looking for doesn't exist or has been moved."}
          </p>
        </div>

        <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-colors duration-micro focus-ring"
          >
            <Home className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
          <Link
            href="/book"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border font-medium text-sm transition-colors duration-micro focus-ring"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Book Haircut
          </Link>
        </div>
      </div>
    </div>
  )
}
