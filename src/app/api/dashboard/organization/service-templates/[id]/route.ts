import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { updateServiceTemplate } from '@/lib/organization/service-template-service'

export const dynamic = 'force-dynamic'

/**
 * Change a standard service.
 *
 * Authorisation is checked here, not by whether the screen showed a button, and the
 * template must belong to the caller's organization: the service layer scopes the lookup by
 * organizationId and returns "not part of this organization" otherwise.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'This page is for people who belong to an organization.' }, { status: 403 })
  }
  const context = resolved.context

  if (!can(context.role, 'services.manage')) {
    return NextResponse.json({ error: 'You do not have permission to change the organization service list.' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'The change could not be read. Please try again.' }, { status: 400 })
  }

  try {
    const result = await updateServiceTemplate(context.organizationId, auth.user.id, id, body)
    if (!result.ok) {
      const status = result.errors.some((e) => e.includes('not part of this organization')) ? 404 : 400
      return NextResponse.json({ error: result.errors.join(' '), errors: result.errors }, { status })
    }
    return NextResponse.json({ template: result.template })
  } catch (error) {
    console.error('service template update failed:', error)
    return NextResponse.json({ error: 'The change could not be saved. Nothing has changed.' }, { status: 500 })
  }
}
