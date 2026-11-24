export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { can, describeRole } from '@/lib/organization/capabilities'
import { loadManagedLocations } from '@/lib/organization/location-service'
import { regionNames } from '@/lib/organization/location-management'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { RegionsManager } from '@/components/organization/RegionsManager'

export default async function RegionsPage() {
  const auth = await requireAuth().catch(() => null)
  if (!auth?.success) redirect('/login')
  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) redirect('/dashboard/organization/locations')

  const context = resolved.context
  let locations: Awaited<ReturnType<typeof loadManagedLocations>> = []
  let readFailed = false
  try {
    locations = await loadManagedLocations(context)
  } catch {
    readFailed = true
  }

  const managers = await prisma.organizationMember
    .findMany({
      where: { organizationId: context.organizationId, role: 'REGIONAL_MANAGER', status: 'ACTIVE' },
      select: { userId: true, regions: true },
      take: 200,
    })
    .catch(() => [] as { userId: string; regions: string[] }[])

  const managerIds = managers.map((row) => row.userId)
  const people = managerIds.length
    ? await prisma.user
        .findMany({ where: { id: { in: managerIds } }, select: { id: true, name: true, email: true } })
        .catch(() => [] as { id: string; name: string | null; email: string }[])
    : []
  const nameById = new Map(people.map((person) => [person.id, person.name ?? person.email] as [string, string]))

  const regionManagers = managers.map((row) => ({
    userId: row.userId,
    name: nameById.get(row.userId) ?? 'Someone',
    regions: row.regions,
  }))

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/dashboard/organization/locations" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Back to locations
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Regions</h1>
        <p className="mt-2 text-muted-foreground">
          A region is a name that shops share. Renaming one moves every shop in it at once, and a regional manager
          only ever sees the regions they hold.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{describeRole(context.role)}</p>
      </div>

      {readFailed && (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground">
          Locations could not be read just now, so regions cannot be shown. Nothing has changed.
        </p>
      )}

      <RegionsManager
        regions={regionNames(locations)}
        locations={locations.map((row) => ({ businessId: row.businessId, name: row.name, region: row.region, status: row.status }))}
        managers={regionManagers}
        canManage={can(context.role, 'locations.manage')}
      />
    </div>
  )
}
