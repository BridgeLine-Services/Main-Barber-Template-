export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { checkOnboardingRequirements } from '@/lib/onboarding'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/onboarding/review
 * Review & Complete step data: a summary of everything the owner configured,
 * plus the authoritative server-side requirements check.
 *
 * The business is resolved from the DATABASE user record (never the stale
 * session claim), and every query is scoped to that businessId — this
 * endpoint can only ever describe the caller's own shop.
 */
export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const user = auth.user
    try {
      const dbUser = await prisma.user.findUnique({
        where: user.id ? { id: user.id } : { email: user.email },
        select: { businessId: true },
      })
      if (!dbUser?.businessId) {
        return NextResponse.json(
          { error: 'Create your business basics first.', code: 'NO_BUSINESS' },
          { status: 409 }
        )
      }
      const businessId = dbUser.businessId
      const [business, services, barbers, requirements] = await Promise.all([
        prisma.business.findUnique({
          where: { id: businessId },
          select: {
            name: true,
            slug: true,
            timezone: true,
            phone: true,
            email: true,
            logo: true,
            primaryColor: true,
            accentColor: true,
            secondaryColor: true,
            themeMode: true,
            fontFamily: true,
            onboardingCompleted: true,
            onboardingStep: true,
            walkInsWelcome: true,
            paymentInPerson: true,
            customerRescheduleEnabled: true,
            customerRescheduleMinNoticeHours: true,
            customerRescheduleWindowDays: true,
            bookingPolicy: true,
            cancellationPolicy: true,
            latePolicy: true,
            noShowPolicyText: true,
          },
        }),
        prisma.service.findMany({
          where: { businessId, isActive: true },
          select: { id: true, name: true, duration: true, price: true, description: true },
          orderBy: { order: 'asc' },
        }),
        prisma.barber.findMany({
          where: { businessId, isActive: true },
          select: {
            id: true,
            name: true,
            slug: true,
            specialty: true,
            photo: true,
            schedules: {
              select: { dayOfWeek: true, isOff: true, startTime: true, endTime: true },
              orderBy: { dayOfWeek: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        }),
        checkOnboardingRequirements(businessId),
      ])
      if (!business) {
        return NextResponse.json(
          { error: 'Business not found.', code: 'NO_BUSINESS' },
          { status: 409 }
        )
      }
      return NextResponse.json({
        business,
        services,
        barbers,
        requirements, // { ok, missing: [{ code, label, hint, step }] }
      })
    } catch (error: any) {
      console.error('Onboarding review error:', error)
      return NextResponse.json({ error: 'Failed to load your setup summary.' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/onboarding/review')
  }
}
