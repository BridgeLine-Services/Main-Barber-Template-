export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { buildReadinessReport, publicReadinessView, readinessHttpStatus } from '@/lib/health'

/**
 * Readiness. "Can this deployment safely handle real work right now?"
 *
 * 200 means bookable, 503 means a critical dependency (the database) is down.
 * A degraded-but-usable shop still answers 200: its pages work, and the body
 * says which part is temporarily refusing work. That distinction is what stops a
 * load balancer from taking the whole site out because email is misconfigured.
 *
 * The response is intentionally minimal — names and statuses only — so this
 * endpoint cannot be used to fingerprint the stack. The owner-facing screen reads
 * the same report server-side, where the detail belongs.
 */
export async function GET() {
  const report = await buildReadinessReport()
  return NextResponse.json(publicReadinessView(report), {
    status: readinessHttpStatus(report),
    headers: { 'cache-control': 'no-store' },
  })
}
