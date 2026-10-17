/**
 * Membership plans (owner-managed catalog).
 *   GET  /api/dashboard/memberships/plans     — staff: list (includes inactive)
 *   POST /api/dashboard/memberships/plans     — owner: create
 *   PATCH /api/dashboard/memberships/plans    — owner: update by { id, ...patch }
 *   DELETE /api/dashboard/memberships/plans   — owner: deactivate (never hard-delete
 *                                                 history-referenced plans)
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { listPlans, validatePlanInput } from '@/lib/memberships'
import { z } from 'zod'

const planSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
  billingInterval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).default('MONTHLY'),
  price: z.number().positive().max(100000),
  currency: z.string().length(3).optional(),
  serviceDiscountPercent: z.number().min(0).max(100).default(0),
  includedVisitsPerPeriod: z.number().int().min(-1).max(1000).default(0),
  visitWindowDays: z.number().int().min(1).max(365).default(30),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
})

const patchSchema = planSchema.partial().extend({ id: z.string().min(1) })

type SessionUser = { role: string; businessId?: string | null }

async function sessionUser(): Promise<SessionUser | null> {
  const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
  const user = session?.user
  if (!user?.businessId) return null
  return user
}

export async function GET() {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ plans: await listPlans(user.businessId, true) })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/memberships/plans')
  }
}

export async function POST(request: Request) {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!can(user.role, 'business.manage-settings')) {
      return NextResponse.json({ error: 'Only owners can create membership plans' }, { status: 403 })
    }
    const parsed = planSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }
    const check = validatePlanInput(parsed.data)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
    const plan = await prisma.membershipPlan.create({
      data: { businessId: user.businessId, ...parsed.data },
    })
    return NextResponse.json({ success: true, plan }, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/memberships/plans')
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!can(user.role, 'business.manage-settings')) {
      return NextResponse.json({ error: 'Only owners can change membership plans' }, { status: 403 })
    }
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }
    const { id, ...patch } = parsed.data
    if (patch.price !== undefined || patch.serviceDiscountPercent !== undefined || patch.includedVisitsPerPeriod !== undefined) {
      const check = validatePlanInput({ name: patch.name ?? 'Plan', price: patch.price, serviceDiscountPercent: patch.serviceDiscountPercent, includedVisitsPerPeriod: patch.includedVisitsPerPeriod, visitWindowDays: patch.visitWindowDays })
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
    }
    // Tenant scope: updateMany filters by businessId — a foreign plan id is a 404.
    const result = await prisma.membershipPlan.updateMany({
      where: { id, businessId: user.businessId },
      data: patch,
    })
    if (result.count === 0) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    return handleApiError(error, 'PATCH /api/dashboard/memberships/plans')
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!can(user.role, 'business.manage-settings')) {
      return NextResponse.json({ error: 'Only owners can remove membership plans' }, { status: 403 })
    }
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Plan id required' }, { status: 400 })
    // Deactivate instead of delete so membership history stays intact.
    const result = await prisma.membershipPlan.updateMany({
      where: { id, businessId: user.businessId },
      data: { active: false },
    })
    if (result.count === 0) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/memberships/plans')
  }
}
