'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

/**
 * Shared sign-out control for server-rendered surfaces (the unified /login
 * page and the public "not yet set up" gate). Renders the button and handles
 * the next-auth sign-out POST + redirect client-side.
 */
export function SignOutButton({
  label = 'Sign out',
  redirectTo = '/login',
}: {
  label?: string
  redirectTo?: string
}) {
  const [loading, setLoading] = useState(false)

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="inline-flex items-center gap-2"
      disabled={loading}
      aria-busy={loading}
      onClick={() => {
        setLoading(true)
        void signOut({ callbackUrl: redirectTo })
      }}
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
      {loading ? 'Signing out…' : label}
    </Button>
  )
}
