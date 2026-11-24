export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { PricingRequests } from '@/components/organization/PricingRequests'

/**
 * Prices a location has asked to change, and the decisions on them.
 *
 * The organization comes from the session, never from the URL. A location manager sees only
 * their own locations' requests because the API filters by the same resolved scope.
 */
export default async function PricingPage() {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Service prices</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            This page is for people who belong to an organization. Your shop keeps its own prices on the services page.
          </p>
          <Link href="/dashboard/services" className="mt-3 inline-block text-sm font-medium text-[var(--dash-brand)] underline">
            Go to your services
          </Link>
        </div>
      </div>
    )
  }

  const context = resolved.context
  if (!can(context.role, 'services.read')) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Service prices</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            Your role cannot see service prices. {describeRole(context.role)}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
        <h1 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">Service prices</h1>
        <p className="mt-2 text-muted-foreground">
          A location can ask to charge something different from the standard price. Nothing changes until an owner or
          corporate admin approves it, and the previous price stays in the history.
        </p>
      </div>
      <PricingRequests />
    </div>
  )
}
