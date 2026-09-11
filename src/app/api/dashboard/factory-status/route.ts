export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { verifyFactoryReadiness } from '@/lib/production-readiness'

/** Owner-only, tenant-scoped readiness report. It intentionally returns no env values. */
export async function GET() {
  const auth = await requireOwner()
  if (!auth.success) return auth.response

  try {
    const user = await prisma.user.findUnique({
      where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email },
      select: { businessId: true },
    })
    if (!user?.businessId) {
      return NextResponse.json({ error: 'Your shop is not configured yet.', code: 'NO_BUSINESS' }, { status: 409 })
    }

    return NextResponse.json(await verifyFactoryReadiness(user.businessId))
  } catch (error) {
    console.error('[factory-status] Failed to build readiness report', error)
    return NextResponse.json({ error: 'Failed to load factory status.' }, { status: 500 })
  }
}
