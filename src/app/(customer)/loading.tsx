import React from 'react'

export default function Loading() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center space-y-4">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-4 border-accent/20"></div>
        <div className="absolute inset-0 rounded-full border-4 border-accent border-t-transparent animate-spin"></div>
      </div>
      <p className="text-muted-foreground font-medium text-sm animate-pulse tracking-wide font-poppins">
        Loading...
      </p>
    </div>
  )
}
