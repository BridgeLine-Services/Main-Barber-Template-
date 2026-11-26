export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { listServiceTemplates } from '@/lib/organization/service-template-service'
import ServiceTemplates from '@/components/organization/ServiceTemplates'

/**
 * The organization's standard service list.
 *
 * The organization comes from the session, never from the URL. People who are not part of an
 * organization are told plainly where their own services live, rather than shown an empty
 * screen that looks broken.
 */
export default async function OrganizationServicesPage() {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Standard services</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            This page is for people who belong to an organization. Your shop keeps its own services on the services page.
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
        <h1 className="text-2xl font-bold text-foreground">Standard services</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            Your role does not include the organization service list. Ask an organization owner if you need to see it.
          </p>
        </div>
      </div>
    )
  }

  let templates: Awaited<ReturnType<typeof listServiceTemplates>> = []
  let readFailed = false
  try {
    templates = await listServiceTemplates(context.organizationId)
  } catch (error) {
    console.error('service template page failed:', error)
    readFailed = true
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold font-serif text-foreground">Standard services</h1>
        <p className="text-sm text-muted-foreground">
          {context.organizationName} · {describeRole(context.role)}
        </p>
      </header>

      {readFailed ? (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          The standard service list could not be loaded just now. Nothing has changed. Try again in a moment.
        </p>
      ) : (
        <ServiceTemplates initialTemplates={templates} canManage={can(context.role, 'services.manage')} />
      )}
    </div>
  )
}
