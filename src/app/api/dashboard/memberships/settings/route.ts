/**
 * Membership settings (owner only).
 *   PATCH /api/dashboard/memberships/settings — master switch + policy terms.
 *   GET  /api/dashboard/memberships/settings — current settings.
 */
import { NextResponse } from 'next/server'
import { requireBusinessAdmin } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { getMembershipSettings } from '@/lib/memberships'
import { z } from 'zod'

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  renewalNoticeDays: z.number().int().min(0).max(30).optional(),
  pastDueGraceDays: z.number().int().min(0).max(90).optional(),
  terms: z.string().max(5000).nullable().optional(),
})

export async function GET() {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId
    if (!businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json(await getMembershipSettings(businessId))
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/memberships/settings')
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId
    if (!businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!can(auth.user.role, 'business.manage-settings')) {
      return NextResponse.json({ error: 'Only owners can change membership settings' }, { status: 403 })
    }
    const parsed = settingsSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }
    await getMembershipSettings(businessId) // ensure the row exists
    const settings = await prisma.membershipSettings.update({
      where: { businessId },
      data: parsed.data,
    })
    return NextResponse.json({ success: true, enabled: settings.enabled })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/memberships/settings')
  }
}
