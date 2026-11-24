export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { can, describeRole } from '@/lib/organization/capabilities'
import { loadAssignments, loadLocationStates } from '@/lib/organization/assignment-service'
import { assignmentRows, groupByState } from '@/lib/organization/assignment-management'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { AssignmentsManager } from '@/components/organization/AssignmentsManager'

export default async function AssignmentsPage() {
  const auth = await requireAuth().catch(() => null)
  if (!auth?.success) redirect('/login')
  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) redirect('/dashboard/organization/locations')

  const context = resolved.context
  const canAssign = can(context.role, 'staff.assign')

  let rows = [] as ReturnType<typeof assignmentRows>
  let locations = [] as Awaited<ReturnType<typeof loadLocationStates>>
  let readFailed = false
  let people: { id: string; name: string; email: string }[] = []

  try {
    const [assignments, loaded] = await Promise.all([loadAssignments(context), loadLocationStates(context)])
    locations = loaded
    rows = assignmentRows(assignments, loaded, new Date())
  } catch {
    readFailed = true
  }

  if (canAssign) {
    const members = await prisma.organizationMember
      .findMany({ where: { organizationId: context.organizationId, status: 'ACTIVE' }, select: { userId: true }, take: 500 })
      .catch(() => [] as { userId: string }[])
    const ids = Array.from(new Set(members.map((row) => row.userId)))
    const users = ids.length
      ? await prisma.user
          .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
          .catch(() => [] as { id: string; name: string | null; email: string }[])
      : []
    people = users.map((row) => ({ id: row.id, name: row.name ?? row.email, email: row.email }))
  }

  const grouped = groupByState(rows)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/dashboard/organization/locations" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Back to locations
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Employees and assignments</h1>
        <p className="mt-2 text-muted-foreground">
          Who works where, from when to when, and who made the change. Ending an assignment keeps its history; moving
          somebody ends one and starts another on the same day.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{describeRole(context.role)}</p>
      </div>

      {readFailed && (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground">
          Assignments could not be read just now. This is not a statement that there are none.
        </p>
      )}

      <AssignmentsManager
        current={grouped.current}
        upcoming={grouped.upcoming}
        ended={grouped.ended}
        locations={locations.filter((row) => row.status !== 'closed')}
        people={people}
        canAssign={canAssign}
      />
    </div>
  )
}
