export const dynamic = 'force-dynamic'

// Onboarding — Team step API: barbers + their weekly schedules.
// The business is ALWAYS resolved from the database user record (the JWT
// claim can be stale), so cross-business access is impossible.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { resolveOwnerBusinessId } from '@/lib/onboarding'
import { slugify } from '@/lib/onboarding-constants'
import { handleApiError } from '@/lib/api-errors'
import {
  scheduleEntrySchema,
  validateScheduleEntries,
  type ScheduleEntry,
} from '@/lib/validation'

const barberSubset = {
  id: true,
  name: true,
  slug: true,
  specialty: true,
  bio: true,
  photo: true,
  isActive: true,
  order: true,
} as const

const scheduleSelect = {
  id: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  isOff: true,
  breaks: true,
} as const

/** Optional photo: https URL or an uploaded-asset path. */
const photoSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/.+/.test(v) || v.startsWith('/'), {
    message: 'Photo must be an https URL or an uploaded file',
  })
  .nullable()
  .optional()
  .transform((v) => (v === '' || v === null ? null : v))

const createBarberOnboardingSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  specialty: z.string().trim().max(200).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  photo: photoSchema,
  isActive: z.boolean().optional(),
  schedules: z.array(scheduleEntrySchema).min(7).max(7),
})

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await resolveOwnerBusinessId(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'No business linked to your account yet' }, { status: 409 })
    }
    const barbers = await prisma.barber.findMany({
      where: { businessId },
      select: { ...barberSubset, schedules: { select: scheduleSelect, orderBy: { dayOfWeek: 'asc' } } },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({ barbers })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/onboarding/team')
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await resolveOwnerBusinessId(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'Create your business basics first' }, { status: 409 })
    }
    try {
      const body = await req.json()
      const parsed = createBarberOnboardingSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid barber data', details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      const { name, specialty, bio, photo, isActive, schedules } = parsed.data
      // Business-rule validation on the weekly schedule (times + breaks).
      const scheduleError = validateScheduleEntries(schedules as ScheduleEntry[])
      if (scheduleError) {
        return NextResponse.json({ error: scheduleError }, { status: 400 })
      }
      // Unique URL slug for the public /barbers/[slug] page. Barber.slug is
      // globally unique, so de-duplicate with a short suffix when needed.
      let slug = slugify(name) || 'barber'
      if (await prisma.barber.findUnique({ where: { slug } })) {
        slug = `${slug}-${businessId.slice(-6)}`
        while (await prisma.barber.findUnique({ where: { slug } })) {
          slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
        }
      }
      const barber = await prisma.barber.create({
        data: {
          businessId, // server-resolved — never from the request body
          name,
          slug,
          specialty: specialty || null,
          bio: bio || null,
          photo: photo ?? null,
          isActive: isActive ?? true,
          order: 0,
          schedules: {
            create: schedules.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
              isOff: s.isOff,
              breaks: s.breaks ?? [],
            })),
          },
        },
        select: { ...barberSubset, schedules: { select: scheduleSelect, orderBy: { dayOfWeek: 'asc' } } },
      })
      return NextResponse.json({ barber }, { status: 201 })
    } catch (error: any) {
      console.error('Onboarding barber create error:', error)
      return NextResponse.json({ error: 'Failed to add barber' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/onboarding/team')
  }
}
