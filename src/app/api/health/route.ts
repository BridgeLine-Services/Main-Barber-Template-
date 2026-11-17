export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Liveness. "Is this process running, and can it reach its database?"
 *
 * Deliberately narrow: restarting a healthy process because an optional
 * integration is down, or paging someone because Redis blinked, is how an
 * availability problem becomes an outage. Deep checks live in
 * /api/health/ready, which callers must opt into by asking for them.
 *
 * The body keeps its original shape ({ status: 'healthy' | 'degraded' }) because
 * CI and existing monitors poll it; new fields are additive.
 */
export async function GET() {
  try {
    await prisma.business.count()
    return NextResponse.json({
      status: 'healthy',
      checks: { database: 'ok' },
      // The commit makes "which version is live?" answerable without a dashboard
      // login. Not secret, and it is the first thing support asks for.
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    // The operator detail goes to the server log only; the response says what is
    // safe to say. No hostname, no credentials, no stack.
    console.error('[health] Database check failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json(
      { status: 'degraded', checks: { database: 'unavailable' }, timestamp: new Date().toISOString() },
      { status: 503 },
    )
  }
}
