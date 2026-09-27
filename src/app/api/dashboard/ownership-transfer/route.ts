export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'

const transferSchema = z.object({
  targetUserId: z.string().min(1, 'Target user required'),
  // Only used (and required) when a PLATFORM_OWNER initiates the transfer;
  // ignored for business owners, whose business is resolved server-side.
  businessId: z.string().optional(),
})

/**
 * POST /api/dashboard/ownership-transfer
 *
 * Atomically transfers business ownership:
 *   1. Verify the caller is the current owner.
 *   2. Verify the target is an active staff member of the same business.
 *   3. Promote the target to OWNER and demote the caller to BARBER in one
 *      transaction, so the business always keeps exactly one OWNER.
 *   4. Record audit events for both role changes.
 *
 * Business data is untouched. The caller's session JWT keeps the old role
 * until it is refreshed; the next sign-in enforces the new role.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const caller = session.user as any
    // The owning business owner, or a platform owner administering the
    // business, may initiate a transfer. Barbers get 403.
    if (caller.role !== 'OWNER' && caller.role !== 'PLATFORM_OWNER') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = transferSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    // Platform owners operate across businesses: they pass the target
    // business explicitly and it is resolved server-side. A business
    // owner always uses their own business — the client can never
    // choose someone else's.
    let businessId: string | null = null
    if (caller.role === 'PLATFORM_OWNER') {
      businessId = parsed.data.businessId || null
    } else {
      businessId = await getCurrentBusinessId()
    }
    if (!businessId) {
      return NextResponse.json({ error: 'No business context' }, { status: 400 })
    }

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.targetUserId, businessId, isActive: true },
    })
    if (!target) {
      return NextResponse.json(
        { error: 'Target user not found in this business' },
        { status: 404 }
      )
    }
    if (target.id === caller.id) {
      return NextResponse.json({ error: 'Cannot transfer ownership to yourself' }, { status: 400 })
    }
    if (target.role === 'OWNER') {
      return NextResponse.json({ error: 'Target user is already an owner' }, { status: 400 })
    }
    // A platform-owner account keeps its platform privileges: business
    // ownership must never overwrite that role (privilege-loss guard).
    if (target.role === 'PLATFORM_OWNER') {
      return NextResponse.json(
        { error: 'Cannot transfer business ownership to a platform-owner account' },
        { status: 400 }
      )
    }

    const [previousOwner, newOwner] = await prisma.$transaction(async (tx) => {
      // Demote the previous owner — except a PLATFORM_OWNER caller,
      // who must never lose platform privileges via a business transfer.
      const demoted =
        caller.role === 'PLATFORM_OWNER'
          ? await tx.user.findUniqueOrThrow({ where: { id: caller.id } })
          : await tx.user.update({
              where: { id: caller.id },
              data: { role: 'BARBER' },
            })
      const promoted = await tx.user.update({
        where: { id: target.id },
        data: { role: 'OWNER' },
      })
      return [demoted, promoted] as const
    })

    const ip = getClientIP(req)
    await logAudit({
      userId: caller.id,
      businessId,
      action: 'USER_ROLE_CHANGED',
      entityType: 'User',
      entityId: newOwner.id,
      oldValues: { role: 'BARBER', ownershipTransferTo: newOwner.email },
      newValues: { role: 'OWNER', ownershipTransferFrom: previousOwner.email },
      ipAddress: ip,
    })
    await logAudit({
      userId: newOwner.id,
      businessId,
      action: 'USER_ROLE_CHANGED',
      entityType: 'User',
      entityId: previousOwner.id,
      oldValues: { role: 'OWNER', ownershipTransferFrom: previousOwner.email },
      newValues: { role: 'BARBER', ownershipTransferTo: newOwner.email },
      ipAddress: ip,
    })

    return NextResponse.json({
      success: true,
      previousOwner: { id: previousOwner.id, email: previousOwner.email, role: 'BARBER' },
      newOwner: { id: newOwner.id, email: newOwner.email, name: newOwner.name, role: 'OWNER' },
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/ownership-transfer')
  }
}
