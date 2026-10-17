/**
 * Memberships: dashboard list + stats (GET) and staff enrollment (POST).
 *
 * POST /api/dashboard/memberships — enroll a customer (creates PENDING
 * membership + its first payment row through the shop's POS flow; the
 * membership activates only when that payment settles, via webhook or POS).
 * All data is scoped to the session's business.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import {
  MembershipError,
  enrollCustomer,
  getMembershipSettings,
  membershipPaymentMetadata,
  membershipStats,
} from '@/lib/memberships'
import { z } from 'zod'

const enrollSchema = z.object({
  customerId: z.string().min(1),
  planId: z.string().min(1),
  paymentMethod: z.enum(['IN_PERSON', 'CARD']).default('IN_PERSON'),
})

type SessionUser = { role: string; businessId?: string | null }

export async function GET() {
  try {
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = user.businessId

    const [settings, stats, memberships] = await Promise.all([
      getMembershipSettings(businessId),
      membershipStats(businessId),
      prisma.membership.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          plan: { select: { name: true, price: true, billingInterval: true } },
          customer: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
    ])
    return NextResponse.json({
      enabled: settings.enabled,
      stats,
      memberships: memberships.map((m) => ({
        id: m.id,
        status: m.status,
        customerName: `${m.customer.firstName} ${m.customer.lastName}`,
        customerEmail: m.customer.email,
        planName: m.plan.name,
        planPrice: m.plan.price,
        billingInterval: m.plan.billingInterval,
        startedAt: m.startedAt,
        currentPeriodEnd: m.currentPeriodEnd,
        autoRenew: m.autoRenew,
        canceledAt: m.canceledAt,
        endedAt: m.endedAt,
      })),
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/memberships')
  }
}

export async function POST(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = user.businessId

    const parsed = enrollSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }

    // Customer must belong to THIS business (no cross-tenant enrollment).
    const customer = await prisma.customer.findFirst({
      where: { id: parsed.data.customerId, businessId },
      select: { id: true },
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    const { membership } = await enrollCustomer({
      businessId,
      customerId: parsed.data.customerId,
      planId: parsed.data.planId,
    })

    // First-period payment row. POS (IN_PERSON) settles immediately and
    // activates in the same transaction; CARD creates a PENDING Stripe
    // intent that activates via webhook when it settles.
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { id: membership.planId } })
    const payment = await prisma.payment.create({
      data: {
        businessId,
        customerId: parsed.data.customerId,
        kind: 'CHARGE',
        method: parsed.data.paymentMethod,
        provider: parsed.data.paymentMethod === 'IN_PERSON' ? 'in_person' : 'stripe',
        amount: plan.price,
        status: parsed.data.paymentMethod === 'IN_PERSON' ? 'SUCCEEDED' : 'PENDING',
        metadata: membershipPaymentMetadata(membership.id),
      },
    })
    if (parsed.data.paymentMethod === 'IN_PERSON') {
      const { activateMembershipForPayment } = await import('@/lib/memberships')
      await activateMembershipForPayment(payment.id)
    }

    return NextResponse.json({ success: true, membershipId: membership.id, paymentId: payment.id }, { status: 201 })
  } catch (error) {
    if (error instanceof MembershipError) {
      const status = error.code === 'MEMBERSHIP_DISABLED' ? 503 : error.code === 'NOT_FOUND' ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    return handleApiError(error, 'POST /api/dashboard/memberships')
  }
}
