/**
 * Dashboard ecommerce settings (owner only).
 *   GET   /api/dashboard/ecommerce/settings
 *   PATCH /api/dashboard/ecommerce/settings — master switch + tax/shipping rules
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { getEcommerceSettings } from '@/lib/ecommerce'
import { z } from 'zod'

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  currency: z.string().trim().length(3).optional(),
  taxRatePercent: z.number().min(0).max(100).optional(),
  shippingFlatRate: z.number().min(0).max(100000).optional(),
  freeShippingThreshold: z.number().min(0).max(100000).nullable().optional(),
  supportEmail: z.string().trim().email().nullable().optional(),
})

type SessionUser = { role: string; businessId?: string | null }

export async function GET() {
  try {
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json(await getEcommerceSettings(user.businessId))
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/ecommerce/settings')
  }
}

export async function PATCH(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!can(user.role, 'business.manage-settings')) {
      return NextResponse.json({ error: 'Only owners can change storefront settings' }, { status: 403 })
    }
    const parsed = settingsSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }
    await getEcommerceSettings(user.businessId) // ensure the row exists
    const settings = await prisma.ecommerceSettings.update({
      where: { businessId: user.businessId },
      data: parsed.data,
    })
    return NextResponse.json({ success: true, enabled: settings.enabled })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/ecommerce/settings')
  }
}
