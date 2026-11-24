export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveBusiness } from '@/lib/tenant'
import { resolveSessionCustomer } from '@/lib/customer-link'
import { prisma } from '@/lib/prisma'
import { buildReferralCode, normaliseReferralCode, referralLink } from '@/lib/growth/referrals'

async function customerContext() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'CUSTOMER') return { response: NextResponse.json({ error: 'Sign in to your customer account to use referrals.' }, { status: 401 }) }
  const business = await resolveBusiness()
  if (!business) return { response: NextResponse.json({ error: 'Business not found.' }, { status: 404 }) }
  const resolved = await resolveSessionCustomer(session, business.id)
  return { session, business, customer: resolved?.customer ?? null }
}

async function referralResponse(req: NextRequest, createCode: boolean) {
  const context = await customerContext()
  if ('response' in context) return context.response
  const { business, customer } = context
  const program = await prisma.referralProgram.findUnique({
    where: { businessId: business.id },
    select: { enabled: true, codePrefix: true },
  })
  if (!customer) return NextResponse.json({ enabled: program?.enabled ?? false, code: null, link: null, activity: null })

  let code: string | null = null
  if (program?.enabled) {
    const existing = await prisma.referralCode.findUnique({
      where: { businessId_customerId: { businessId: business.id, customerId: customer.id } },
      select: { code: true, active: true },
    })
    if (existing?.active) {
      code = existing.code
    } else if (!existing && createCode) {
      let candidate = buildReferralCode(program.codePrefix, customer.id)
      for (let attempt = 0; attempt < 6; attempt++) {
        const normalised = normaliseReferralCode(candidate)
        const clash = await prisma.referralCode.findUnique({
          where: { businessId_code: { businessId: business.id, code: normalised } },
          select: { id: true },
        })
        if (!clash) break
        candidate = buildReferralCode(program.codePrefix, customer.id, attempt + 1)
      }
      try {
        const created = await prisma.referralCode.create({
          data: { businessId: business.id, customerId: customer.id, code: normaliseReferralCode(candidate) },
          select: { code: true },
        })
        code = created.code
      } catch {
        const concurrent = await prisma.referralCode.findUnique({
          where: { businessId_customerId: { businessId: business.id, customerId: customer.id } },
          select: { code: true, active: true },
        })
        code = concurrent?.active ? concurrent.code : null
      }
    }
  }

  const referredAttributions = await prisma.referralAttribution.findMany({
    where: { businessId: business.id, referrerCustomerId: customer.id },
    select: { customerId: true },
  })
  const referredCustomerIds = referredAttributions.map((row) => row.customerId)
  const completedBookings = referredCustomerIds.length
    ? await prisma.appointment.count({
        where: { businessId: business.id, status: 'COMPLETED', customerId: { in: referredCustomerIds } },
      })
    : 0

  return NextResponse.json({
    enabled: program?.enabled ?? false,
    code,
    link: code ? referralLink(`${req.nextUrl.origin}/book`, code) : null,
    activity: { referredCustomers: referredAttributions.length, completedBookings },
  })
}

export async function GET(req: NextRequest) {
  return referralResponse(req, false)
}

export async function POST(req: NextRequest) {
  return referralResponse(req, true)
}
