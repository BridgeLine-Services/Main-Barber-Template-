export const dynamic = 'force-dynamic'

// Onboarding — update/delete a single barber (owner's own business only).
// Schedule updates replace the barber's week atomically.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { resolveOwnerBusinessId } from '@/lib/onboarding'
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

const updateBarberOnboardingSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  specialty: z.string().trim().max(200).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  photo: photoSchema,
  isActive: z.boolean().optional(),
  // When present, replaces the full week (7 entries required).
  schedules: z.array(scheduleEntrySchema).min(7).max(7).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await resolveOwnerBusinessId(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'No business linked to your account' }, { status: 409 })
    }
    // Ownership check: the barber must belong to the owner's business.
    const existing = await prisma.barber.findFirst({
      where: { id: params.id, businessId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    }
    try {
      const body = await req.json()
      const parsed = updateBarberOnboardingSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid barber data', details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      const { name, specialty, bio, photo, isActive, schedules } = parsed.data
      if (schedules) {
        const scheduleError = validateScheduleEntries(schedules as ScheduleEntry[])
        if (scheduleError) {
          return NextResponse.json({ error: scheduleError }, { status: 400 })
        }
      }
      const barber = await prisma.$transaction(async (tx) => {
        if (schedules) {
          await tx.schedule.deleteMany({ where: { barberId: existing.id } })
          await tx.schedule.createMany({
            data: schedules.map((s) => ({
              barberId: existing.id,
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
              isOff: s.isOff,
              breaks: s.breaks ?? [],
            })),
          })
        }
        return tx.barber.update({
          where: { id: existing.id },
          data: {
            ...(name !== undefined && { name }),
            ...(specialty !== undefined && { specialty: specialty || null }),
            ...(bio !== undefined && { bio: bio || null }),
            ...(photo !== undefined && { photo }),
            ...(isActive !== undefined && { isActive }),
          },
          select: { ...barberSubset, schedules: { select: scheduleSelect, orderBy: { dayOfWeek: 'asc' } } },
        })
      })
      return NextResponse.json({ barber })
    } catch (error: any) {
      console.error('Onboarding barber update error:', error)
      return NextResponse.json({ error: 'Failed to update barber' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/onboarding/team/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await resolveOwnerBusinessId(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'No business linked to your account' }, { status: 409 })
    }
    // Ownership check before delete — cross-business ids are simply 404s.
    const existing = await prisma.barber.findFirst({
      where: { id: params.id, businessId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    }
    try {
      await prisma.barber.delete({ where: { id: existing.id } }) // schedules cascade
      return NextResponse.json({ success: true })
    } catch (error: any) {
      console.error('Onboarding barber delete error:', error)
      return NextResponse.json({ error: 'Failed to delete barber' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/onboarding/team/[id]')
  }
}
