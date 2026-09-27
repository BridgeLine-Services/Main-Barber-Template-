import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveBusiness } from '@/lib/tenant'
import { createCode, hashValue, normalizeContact, PORTAL_CODE_TTL_MS, sendPortalCode } from '@/lib/portal-security'
import { isPublicBusinessDeactivated } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
const NEUTRAL = 'Check your email or phone for your verification code.'

export async function POST(req: NextRequest) {
  // Soft-deactivated shops do not accept public activity
  if (await isPublicBusinessDeactivated()) {
    return NextResponse.json(
      { error: 'This shop is not accepting bookings right now.' },
      { status: 503 }
    )
  }
  const limited = checkRateLimit(req, 'portal-verification-request', RATE_LIMITS.PORTAL_LOOKUP)
  if (limited) return NextResponse.json({ message: NEUTRAL }, { status: 200 })
  try {
    const body = await req.json()
    const contact = normalizeContact(body.email, body.phone)
    if (!contact || contact.value.length < 6) return NextResponse.json({ message: NEUTRAL }, { status: 200 })
    const business = await resolveBusiness()
    const customer = contact.channel === 'EMAIL'
      ? await prisma.customer.findFirst({ where: { businessId: business.id, email: contact.value } })
      : (await prisma.customer.findMany({ where: { businessId: business.id } })).find((candidate: { phone: string }) => candidate.phone.replace(/\D/g, '') === contact.value)
    if (customer) {
      const code = createCode()
      await prisma.portalVerificationChallenge.create({ data: { businessId: business.id, contactHash: hashValue(contact.value), channel: contact.channel, codeHash: hashValue(code), expiresAt: new Date(Date.now() + PORTAL_CODE_TTL_MS) } })
      await sendPortalCode(contact.channel, contact.channel === 'EMAIL' ? customer.email : customer.phone, code, business.name)
    }
    return NextResponse.json({ message: NEUTRAL })
  } catch {
    return NextResponse.json({ message: NEUTRAL }, { status: 200 })
  }
}
