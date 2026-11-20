import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

/**
 * The organization this signed-in person belongs to, and what they may do.
 *
 * The organization is resolved from the session only. There is no query parameter that
 * can point this at another organization.
 */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    // A shop without an organization is a normal, supported state, not an error.
    return NextResponse.json({
      organization: null,
      reason: resolved.reason,
      message: resolved.message,
    })
  }

  const context = resolved.context
  return NextResponse.json({
    organization: {
      id: context.organizationId,
      name: context.organizationName,
      role: context.role,
      roleDescription: describeRole(context.role),
      regions: context.regions,
      locationCount: context.locationBusinessIds.length,
    },
  })
}
