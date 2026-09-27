export const dynamic = 'force-dynamic'

/**
 * Feature configuration API (Requirement 27).
 *
 * GET  — owner reads the resolved feature map for THEIR business
 * PUT  — owner sets feature overrides for THEIR business (audited)
 *
 * Tenant-scoped via requireOwner() (the owner's businessId comes from
 * the session, never from the request body). Unknown feature keys are
 * rejected with 400 rather than silently stored.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { FEATURE_DEFAULTS, FEATURE_KEYS, resolveFeatures } from '@/lib/features'

function parseFeaturePayload(body: unknown): { overrides: Record<string, boolean> } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body must be a JSON object' }
  }
  const entries = Object.entries(body as Record<string, unknown>)
  const overrides: Record<string, boolean> = {}
  for (const [key, value] of entries) {
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) {
      return { error: `Unknown feature key: ${key}` }
    }
    if (typeof value !== 'boolean') return { error: `Feature '${key}' must be a boolean` }
    overrides[key] = value
  }
  return { overrides }
}

export async function GET() {
  const auth = await requireOwner()
  if (!auth.success) return auth.response
  const businessId = auth.user.businessId
  if (!businessId) return NextResponse.json({ error: 'No business for user' }, { status: 400 })
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { featureOverrides: true },
  })
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 })
  return NextResponse.json({
    features: resolveFeatures(business),
    defaults: FEATURE_DEFAULTS,
    overrides: business.featureOverrides ?? {},
  })
}

export async function PUT(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.success) return auth.response
  const businessId = auth.user.businessId
  const userId = auth.user.id
  if (!businessId) return NextResponse.json({ error: 'No business for user' }, { status: 400 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = parseFeaturePayload(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { featureOverrides: true },
  })
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  // Merge with existing overrides so partial updates are safe.
  const merged = {
    ...((business.featureOverrides as Record<string, boolean> | null) ?? {}),
    ...parsed.overrides,
  }
  const updated = await prisma.business.update({
    where: { id: businessId },
    data: { featureOverrides: merged },
    select: { featureOverrides: true },
  })

  await prisma.auditLog.create({
    data: {
      businessId,
      userId,
      action: 'FEATURE_CONFIG_UPDATED',
      entityType: 'Business',
      entityId: businessId,
      newValues: { overrides: parsed.overrides },
    },
  })

  return NextResponse.json({
    features: resolveFeatures(updated),
    overrides: updated.featureOverrides ?? {},
  })
}
