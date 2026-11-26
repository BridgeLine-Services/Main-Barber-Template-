export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { loadBrandSettings, loadLocationBrands } from '@/lib/organization/brand-settings-service'
import BrandEditor from '@/components/organization/BrandEditor'

/**
 * The organization's shared brand.
 *
 * The organization comes from the session. A single-shop owner who opens this is told, in plain
 * words, where their own branding lives, rather than shown an empty page that looks broken.
 */
export default async function OrganizationBrandingPage() {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Shared brand</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            This page is for people who belong to an organization. Your shop sets its own look on the branding page.
          </p>
          <Link href="/dashboard/settings?tab=branding" className="mt-3 inline-block text-sm font-medium text-[var(--dash-brand)] underline">
            Go to your branding
          </Link>
        </div>
      </div>
    )
  }

  const context = resolved.context
  if (!can(context.role, 'branding.read')) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Shared brand</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            Your role does not include the organization brand. Ask an organization owner if you need to see it.
          </p>
        </div>
      </div>
    )
  }

  let settings = null
  let locations: Awaited<ReturnType<typeof loadLocationBrands>> = []
  let readFailed = false
  try {
    ;[settings, locations] = await Promise.all([
      loadBrandSettings(context.organizationId),
      loadLocationBrands(context.organizationId),
    ])
  } catch (error) {
    console.error('branding page failed:', error)
    readFailed = true
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold font-serif text-foreground">Shared brand</h1>
        <p className="text-sm text-muted-foreground">
          {context.organizationName} · {describeRole(context.role)}
        </p>
      </header>

      {readFailed ? (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          The shared brand could not be loaded just now. Nothing has changed. Try again in a moment.
        </p>
      ) : (
        <BrandEditor initialSettings={settings} locations={locations} canManage={can(context.role, 'branding.manage')} />
      )}
    </div>
  )
}
