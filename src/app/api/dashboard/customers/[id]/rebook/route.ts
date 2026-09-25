export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validateSlot, createAppointmentSafely } from '@/lib/availability'
import { getRebookingSuggestion } from '@/lib/customer-intelligence'
import { formatPreferencesForDisplay } from '@/lib/customer-history'
import { handleApiError } from '@/lib/api-errors'

// POST /api/dashboard/customers/[id]/rebook
// Creates a rebooking appointment using customer intelligence:
// - Preselects favorite barber, favorite service
// - Uses suggested date (average interval from last visit)
// - Finds closest available time slot on that date
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    // Verify customer belongs to this business
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, businessId },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, notes: true, smsConsent: true },
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    // Allow override of suggested barber/service/date, or use suggestion
    const suggestion = await getRebookingSuggestion(params.id, businessId)
    const barberId = body.barberId || suggestion.barber?.id
    const serviceId = body.serviceId || suggestion.service?.id
    if (!barberId) return NextResponse.json({ error: 'No barber available to rebook with' }, { status: 400 })
    if (!serviceId) return NextResponse.json({ error: 'No service available to rebook' }, { status: 400 })
    // Determine the date to book
    let bookingDate: Date
    if (body.date) {
      bookingDate = new Date(body.date)
    } else if (suggestion.suggestedDate) {
      bookingDate = suggestion.suggestedDate
    } else {
      return NextResponse.json({ error: 'No suggested date available' }, { status: 400 })
    }
    // If a specific time is provided, use it; otherwise find the earliest available slot
    if (body.time) {
      // Parse the time string (e.g. "2:00 PM") into a Date
      const [timeStr, period] = body.time.split(' ')
      const [hours, minutes] = timeStr.split(':').map(Number)
      let hour24 = hours
      if (period === 'PM' && hours !== 12) hour24 += 12
      if (period === 'AM' && hours === 12) hour24 = 0
      bookingDate.setHours(hour24, minutes, 0, 0)
      // Validate the slot
      const validation = await validateSlot({
        businessId,
        barberId,
        serviceId,
        startTime: bookingDate,
      })
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }
    } else {
      // Find earliest available slot on the suggested date
      const { getAvailableSlots } = await import('@/lib/availability')
      const slots = await getAvailableSlots({ businessId, barberId, serviceId, date: bookingDate })
      const firstAvailable = slots.find(s => s.available)
      if (!firstAvailable) {
        return NextResponse.json({
          error: 'No available slots on the suggested date. Try a different date.',
          suggestedDate: bookingDate.toISOString(),
        }, { status: 400 })
      }
      // Parse the time string into the booking date
      const [timeStr, period] = firstAvailable.time.split(' ')
      const [hours, minutes] = timeStr.split(':').map(Number)
      let hour24 = hours
      if (period === 'PM' && hours !== 12) hour24 += 12
      if (period === 'AM' && hours === 12) hour24 = 0
      bookingDate.setHours(hour24, minutes, 0, 0)
    }
    // Create the appointment
    const result = await createAppointmentSafely({
      businessId,
      barberId,
      serviceId,
      startTime: bookingDate,
      customerData: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email,
        notes: customer.notes || undefined,
        smsConsent: customer.smsConsent,
      },
    })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    // Log to audit log
    try {
      await prisma.auditLog.create({
        data: {
          businessId,
          userId,
          action: 'APPOINTMENT_CREATED',
          entityType: 'Appointment',
          entityId: result.appointment.id,
          newValues: {
            rebooked: true,
            customerId: params.id,
            barberId,
            serviceId,
            startTime: bookingDate.toISOString(),
          },
        },
      })
    } catch (e) {
      // Non-critical
    }
    return NextResponse.json({
      success: true,
      appointment: result.appointment,
      message: `Rebooked ${customer.firstName} ${customer.lastName} with ${result.appointment.barber.name} for ${result.appointment.service.name}`,
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/customers/[id]/rebook')
  }
}

// GET /api/dashboard/customers/[id]/rebook
// Returns the rebooking suggestion without creating an appointment
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, businessId },
      select: { id: true, preferences: true },
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    // Optional query overrides (?barberId=&serviceId=&date=YYYY-MM-DD) let the
    // caller scope the preview to a specific barber/service/date — e.g. a
    // barber offering to rebook a customer into their own chair. The overrides
    // only change which slots are previewed; creation still goes through the
    // canonical booking engine.
    const url = new URL(req.url)
    const barberOverride = url.searchParams.get('barberId')
    const serviceOverride = url.searchParams.get('serviceId')
    const dateOverride = url.searchParams.get('date') // "YYYY-MM-DD"
    // Validate overrides belong to this business (tenant isolation)
    let overrideBarber: { id: string; name: string } | null = null
    let overrideService: { id: string; name: string; duration: number; price: number } | null = null
    if (barberOverride) {
      overrideBarber = await prisma.barber.findFirst({
        where: { id: barberOverride, businessId, isActive: true },
        select: { id: true, name: true },
      })
      if (!overrideBarber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    }
    if (serviceOverride) {
      overrideService = await prisma.service.findFirst({
        where: { id: serviceOverride, businessId, isActive: true },
        select: { id: true, name: true, duration: true, price: true },
      })
      if (!overrideService) return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }
    const suggestion = await getRebookingSuggestion(params.id, businessId)
    const previewBarber = overrideBarber ?? suggestion.barber
    const previewService = overrideService ?? suggestion.service
    let previewDate: Date | null = suggestion.suggestedDate
    if (dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
      previewDate = new Date(`${dateOverride}T12:00:00.000Z`)
    }
    // Surface saved preferences so staff can honor them during rebooking.
    // Informational only — the customer's selected service is never changed
    // based on notes or preferences.
    const preferences = formatPreferencesForDisplay(customer.preferences)
    // Also fetch available slots for the preview barber/service/date
    let availableSlots: { time: string; available: boolean }[] = []
    if (previewBarber && previewService && previewDate) {
      const { getAvailableSlots } = await import('@/lib/availability')
      availableSlots = await getAvailableSlots({
        businessId,
        barberId: previewBarber.id,
        serviceId: previewService.id,
        date: previewDate,
      })
    }
    return NextResponse.json({
      ...suggestion,
      barber: previewBarber,
      service: previewService,
      suggestedDate: previewDate,
      availableSlots,
      preferences,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/customers/[id]/rebook')
  }
}
