// Login page — server component. The single public Login / Sign-Up entry
// point for everyone. Owner registration is controlled by the deployment mode:
// `onboarding` enables the first-owner flow, `invite_only` hides public sign-up,
// and `disabled` prevents new registrations.
//
// A visitor with an ACTIVE session is NOT silently bounced to their role
// destination: that made "Owner Login" appear dead for a signed-in customer
// (URL changed to /portal, form never appeared). Instead the form renders
// together with a "signed in as ..." notice offering Sign out and Continue,
// so account switching is always visible and actionable on every device.

import { resolveBusiness } from '@/lib/tenant'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import {
  isCustomerRegistrationOpen,
  isOwnerRegistrationOpen,
  parseOwnerRegistrationMode,
} from '@/lib/owner-registration'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { roleLabel } from '@/lib/role-labels'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  const session = await getServerSession(authOptions)
  const sessionUser = session?.user as { name?: string | null; email?: string | null; role?: string } | undefined

  const business = await resolveBusiness().catch(() => null)
  const ownerRegistrationMode = parseOwnerRegistrationMode(process.env.OWNER_REGISTRATION_MODE)
  const hasOwner = !!(await prisma.user.findFirst({ where: { role: 'OWNER' }, select: { id: true } }))

  return (
    <>
      {business && (
        <ThemeStyle business={business} />
      )}
      {sessionUser && (
        <div
          role="status"
          className="w-full border-b border-border/60 bg-muted/60 text-foreground"
        >
          <div className="mx-auto flex max-w-3xl flex-col items-start justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              You&apos;re signed in as{' '}
              <span className="font-medium text-foreground">{sessionUser.email || sessionUser.name}</span>
              {sessionUser.role ? ` (${roleLabel(sessionUser.role)})` : ''}. Sign out
              to use a different account.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <SignOutButton redirectTo="/login" />
              <Link
                href="/auth/redirect"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Continue as this account →
              </Link>
            </div>
          </div>
        </div>
      )}
      <LoginForm
        businessName={business?.name ?? null}
        ownerRegistrationMode={ownerRegistrationMode}
        ownerRegistrationOpen={isOwnerRegistrationOpen(process.env.OWNER_REGISTRATION_MODE, hasOwner)}
        customerRegistrationOpen={isCustomerRegistrationOpen(process.env.OWNER_REGISTRATION_MODE)}
      />
    </>
  )
}
