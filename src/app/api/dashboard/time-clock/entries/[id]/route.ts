/**
 * Single time entry API.
 *
 * GET   /api/dashboard/time-clock/entries/[id] — entry with breaks and the
 *        full correction trail. Owner only... EXCEPT a barber may view
 *        their OWN entry (security spec: "barbers can view their own time
 *        records"). Barbers can never modify here — PATCH is owner-only.
 * PATCH /api/dashboard/time-clock/entries/[id] — OWNER manual correction.
 *        Every changed field appends an immutable revision row (original
 *        value, new value, who, when, required reason). Barbers get 403;
 *        they cannot modify historical records unless explicitly
 *        permitted, and "permitted" corrections only exist for owners in
 *        this design (the owner is the correction authority).
 *
 * Body: { clockInAt?, clockOutAt?, breakMinutes?, notes?, reason (required) }
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { correctTimeEntry, TimeClockError, canManageTimeClock } from '@/lib/time-clock'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    const { id } = await params
    if (!user.businessId) {
      return NextResponse.json({ error: 'Business required' }, { status: 403 })
    }

    const entry = await prisma.timeClockEntry.findFirst({
      where: { id, businessId: user.businessId },
      include: {
        barber: { select: { name: true } },
        breaks: { orderBy: { startedAt: 'asc' } },
        revisions: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

    // Barbers see their own records only; owners see everything in-shop.
    if (!canManageTimeClock(user.role)) {
      if (user.role !== 'BARBER' || user.barberId !== entry.barberId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Own record: OK, but the revision trail is owner-tooling.
      return NextResponse.json({ entry: { ...entry, revisions: undefined } })
    }
    return NextResponse.json({ entry })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/time-clock/entries/[id]')
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    // OWNER correction authority — server-side on every request.
    if (!canManageTimeClock(user.role) || !user.businessId) {
      return NextResponse.json({ error: 'Forbidden: Owner access required' }, { status: 403 })
    }
    const { id } = await params
    const body = (await request.json()) as Record<string, unknown>

    const parseDate = (v: unknown): Date | null | undefined => {
      if (v === null) return null
      if (typeof v === 'string' || typeof v === 'number' || v instanceof Date) {
        const d = new Date(v)
        return isNaN(d.getTime()) ? undefined : d
      }
      return undefined
    }

    try {
      const result = await correctTimeEntry({
        entryId: id,
        businessId: user.businessId,
        changedBy: {
          userId: user.id,
          name: user.name ?? user.email ?? 'Owner',
          email: user.email ?? '',
        },
        reason: typeof body.reason === 'string' ? body.reason : '',
        clockInAt: parseDate(body.clockInAt),
        clockOutAt: parseDate(body.clockOutAt),
        breakMinutes: body.breakMinutes === undefined ? undefined : Number(body.breakMinutes),
        notes: body.notes === undefined ? undefined : (body.notes as string | null),
      })

      if (result.revisions.length) {
        await logAudit({
          userId: user.id,
          businessId: user.businessId,
          action: 'TIME_CLOCK_ENTRY_CORRECTED',
          entityType: 'TimeClockEntry',
          entityId: id,
          oldValues: toAuditJson({
            fields: result.revisions.map((r) => ({ field: r.field, originalValue: r.originalValue })),
          }),
          newValues: toAuditJson({
            fields: result.revisions.map((r) => ({ field: r.field, newValue: r.newValue })),
            reason: body.reason,
          }),
        })
      }

      const entry = await prisma.timeClockEntry.findFirst({
        where: { id, businessId: user.businessId },
        include: { barber: { select: { name: true } }, breaks: true, revisions: { orderBy: { createdAt: 'desc' } } },
      })
      return NextResponse.json({ entry, revisions: result.revisions.length })
    } catch (e) {
      if (e instanceof TimeClockError) {
        const status = e.code === 'INVALID_TIME' ? 400 : 404
        return NextResponse.json({ error: e.message, code: e.code }, { status })
      }
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/time-clock/entries/[id]')
  }
}
