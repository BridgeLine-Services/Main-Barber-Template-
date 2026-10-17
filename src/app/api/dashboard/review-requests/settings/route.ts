import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireBusinessAdmin, getBusinessIdForUser } from '@/lib/auth-helpers'
import { clampReviewDelay, validateReviewUrl } from '@/lib/review-requests'
export async function GET() {
  const auth = await requireBusinessAdmin(); if (!auth.success) return auth.response
  const businessId = await getBusinessIdForUser(auth.user)
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { reviewRequestEnabled: true, reviewRequestDelayMinutes: true, reviewRequestUrl: true, reviewRequestCooldownDays: true } })
  return NextResponse.json(business)
}
export async function PATCH(req: NextRequest) {
  const auth = await requireBusinessAdmin(); if (!auth.success) return auth.response
  const businessId = await getBusinessIdForUser(auth.user)
  const body = await req.json()
  const enabled = Boolean(body.enabled)
  const url = body.reviewUrl ? validateReviewUrl(body.reviewUrl) : null
  if (enabled && !url) return NextResponse.json({ error: 'A valid HTTPS review URL is required when enabled' }, { status: 400 })
  const business = await prisma.business.update({ where: { id: businessId }, data: { reviewRequestEnabled: enabled, reviewRequestDelayMinutes: clampReviewDelay(body.delayMinutes), reviewRequestUrl: url, reviewRequestCooldownDays: Math.min(365, Math.max(1, Math.round(Number(body.cooldownDays) || 30))) }, select: { reviewRequestEnabled: true, reviewRequestDelayMinutes: true, reviewRequestUrl: true, reviewRequestCooldownDays: true } })
  return NextResponse.json(business)
}
