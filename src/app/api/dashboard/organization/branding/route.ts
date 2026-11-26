import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { loadBrandSettings, loadLocationBrands, saveBrandSettings } from '@/lib/organization/brand-settings-service'

export const dynamic = 'force-dynamic'

/**
 * The organization's shared brand, and how it resolves at each location.
 *
 * The organization comes from the session. Nothing in the request can point this at another
 * organization's brand.
 */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ settings: null, locations: [], canManage: false, organization: null, readFailed: false })
  }
  const context = resolved.context

  if (!can(context.role, 'branding.read')) {
    return NextResponse.json({ settings: null, locations: [], canManage: false, organization: null, readFailed: false })
  }

  try {
    const [settings, locations] = await Promise.all([
      loadBrandSettings(context.organizationId),
      loadLocationBrands(context.organizationId),
    ])
    return NextResponse.json({
      organization: { id: context.organizationId, name: context.organizationName, role: context.role, roleDescription: describeRole(context.role) },
      settings,
      locations,
      canManage: can(context.role, 'branding.manage'),
      readFailed: false,
    })
  } catch (error) {
    console.error('branding read failed:', error)
    return NextResponse.json(
      { settings: null, locations: [], canManage: false, organization: null, readFailed: true, error: 'The shared brand could not be loaded just now. Nothing has changed.' },
      { status: 200 }
    )
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'This page is for people who belong to an organization.' }, { status: 403 })
  }
  const context = resolved.context

  // The screen hides the form from people who cannot use it; this is the real boundary.
  if (!can(context.role, 'branding.manage')) {
    return NextResponse.json({ error: 'You do not have permission to change the organization brand.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'The brand could not be read. Please try again.' }, { status: 400 })
  }

  try {
    const result = await saveBrandSettings(context.organizationId, auth.user.id, body)
    if (!result.ok) {
      return NextResponse.json({ error: result.errors.join(' '), errors: result.errors }, { status: 400 })
    }
    return NextResponse.json({ settings: result.settings })
  } catch (error) {
    console.error('branding save failed:', error)
    return NextResponse.json({ error: 'The brand could not be saved. Nothing has changed.' }, { status: 500 })
  }
}
