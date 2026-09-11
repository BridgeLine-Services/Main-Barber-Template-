export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { verifyFactoryLaunch } from '@/lib/factory-launch'

/** Owner-only launch workflow status. No client-supplied business ID is accepted. */
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
    return NextResponse.json(await verifyFactoryLaunch(user.businessId))
  } catch (error) {
    console.error('[factory-launch] Failed to build launch report', error)
    return NextResponse.json({ error: 'Failed to load the factory launch console.' }, { status: 500 })
  }
}
