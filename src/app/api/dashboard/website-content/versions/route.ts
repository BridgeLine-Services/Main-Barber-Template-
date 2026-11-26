export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { describeVersion } from '@/lib/website-versions'

/**
 * GET /api/dashboard/website-content/versions
 *
 * The published history for this shop, newest first. Scoped to the session's business, so a
 * version id from another shop can never appear here. Staff may read; only the owner may
 * publish, and only publishing creates a version.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role === 'CUSTOMER') {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    }
    const businessId = session.user.businessId
    if (!businessId) return NextResponse.json({ versions: [] })

    const rows = await prisma.websiteContentVersion.findMany({
      where: { businessId },
      orderBy: { version: 'desc' },
      take: 50,
      select: { id: true, version: true, summary: true, publishedAt: true, authorId: true },
    })

    return NextResponse.json({
      // Decided here, from the session, so the screen never has to guess.
      canRestore: session.user.role === 'OWNER',
      versions: rows.map((row) => ({
        id: row.id,
        version: row.version,
        summary: row.summary,
        publishedAt: row.publishedAt,
        description: describeVersion(row),
      })),
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/website-content/versions')
  }
}
