import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { createServiceTemplate, listServiceTemplates } from '@/lib/organization/service-template-service'

export const dynamic = 'force-dynamic'

/**
 * The organization's standard service list.
 *
 * The organization comes from the session through resolveOrganizationContext, never from the
 * request, so there is no id here that could point at somebody else's organization.
 */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ templates: [], canManage: false, organization: null, readFailed: false })
  }
  const context = resolved.context

  if (!can(context.role, 'services.read')) {
    return NextResponse.json({ templates: [], canManage: false, organization: null, readFailed: false })
  }

  try {
    const templates = await listServiceTemplates(context.organizationId)
    return NextResponse.json({
      organization: { id: context.organizationId, name: context.organizationName, role: context.role, roleDescription: describeRole(context.role) },
      templates,
      canManage: can(context.role, 'services.manage'),
      readFailed: false,
    })
  } catch (error) {
    console.error('service template list failed:', error)
    return NextResponse.json(
      { templates: [], canManage: false, organization: null, readFailed: true, error: 'The service list could not be loaded just now. Nothing has changed.' },
      { status: 200 }
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'This page is for people who belong to an organization.' }, { status: 403 })
  }
  const context = resolved.context

  // The screen hides the form for people who cannot use it; this is the actual boundary.
  if (!can(context.role, 'services.manage')) {
    return NextResponse.json({ error: 'You do not have permission to change the organization service list.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'The service could not be read. Please fill the form in again.' }, { status: 400 })
  }

  try {
    const result = await createServiceTemplate(context.organizationId, auth.user.id, body)
    if (!result.ok) {
      return NextResponse.json({ error: result.errors.join(' '), errors: result.errors }, { status: 400 })
    }
    return NextResponse.json({ template: result.template }, { status: 201 })
  } catch (error) {
    console.error('service template create failed:', error)
    return NextResponse.json({ error: 'The service could not be saved. Nothing has changed.' }, { status: 500 })
  }
}
