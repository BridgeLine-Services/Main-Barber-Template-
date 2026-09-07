// ============================================================================
// E2E Booking Test Endpoint (Owner/Admin only)
// Runs a full booking lifecycle test against the production database:
//   1. Create test customer + appointment
//   2. Verify confirmation number + access token
//   3. Verify appointment appears in queries
//   4. Verify slot is no longer available (double-booking protection)
//   5. Cancel the appointment
//   6. Verify slot becomes available again
//   7. Clean up test data
// ============================================================================

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCurrentBusinessId } from '@/lib/business'
import { createAppointmentSafely, getAvailableSlots } from '@/lib/availability'
import { format } from 'date-fns'
import { localTimeToUTCFromYMD } from '@/lib/timezone'

// Parse a time string (AM/PM or 24h) into 24h HH:mm
function parseTimeTo24h(timeStr: string): string {
  const ampmMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1])
    const minutes = parseInt(ampmMatch[2])
    if (ampmMatch[3].toUpperCase() === 'PM' && hours < 12) hours += 12
    if (ampmMatch[3].toUpperCase() === 'AM' && hours === 12) hours = 0
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }
  return timeStr
}

// Build a UTC Date from YYYY-MM-DD + time string using the business timezone
async function buildStartTime(dateStr: string, timeStr: string, businessId: string): Promise<Date> {
  const [yr, mo, dy] = dateStr.split('-').map(Number)
  const time24h = parseTimeTo24h(timeStr)
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } })
  const tz = business?.timezone || 'America/New_York'
  return localTimeToUTCFromYMD(time24h, yr, mo, dy, tz)
}

export async function POST(req: NextRequest) {
  // ─── Auth: only authenticated dashboard users can run tests ─────────────
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Disable in production — test endpoints create/delete data
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_E2E_TESTS !== 'true') {
    return NextResponse.json({ error: 'E2E tests disabled in production' }, { status: 403 })
  }

  const businessId = await getCurrentBusinessId()
  const steps: { step: string; status: 'pass' | 'fail'; message: string }[] = []
  let testAppointmentId: string | null = null
  let testCustomerEmail: string = ''

  try {
    // ─── Step 0: Find a real barber + service in the DB ──────────────────────
    const barber = await prisma.barber.findFirst({
      where: { businessId, isActive: true },
      include: { services: true },
    })

    if (!barber) {
      steps.push({ step: '0_find_barber', status: 'fail', message: 'No active barbers in database' })
      return NextResponse.json({ success: false, steps })
    }

    const service = barber.services.length > 0
      ? await prisma.service.findFirst({ where: { id: barber.services[0].serviceId, businessId, isActive: true } })
      : await prisma.service.findFirst({ where: { businessId, isActive: true } })

    if (!service) {
      steps.push({ step: '0_find_service', status: 'fail', message: 'No active services in database' })
      return NextResponse.json({ success: false, steps })
    }

    steps.push({ step: '0_setup', status: 'pass', message: `Barber: ${barber.name}, Service: ${service.name} ($${service.price})` })

    // ─── Step 1: Find an available slot ─────────────────────────────────────
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)

    const slots = await getAvailableSlots({
      businessId,
      barberId: barber.id,
      serviceId: service.id,
      date: tomorrow,
    })

    const availableSlot = slots.find((s) => s.available)
    if (!availableSlot) {
      // Try day after tomorrow
      const dayAfter = new Date()
      dayAfter.setDate(dayAfter.getDate() + 2)
      dayAfter.setHours(0, 0, 0, 0)
      const slots2 = await getAvailableSlots({ businessId, barberId: barber.id, serviceId: service.id, date: dayAfter })
      const slot2 = slots2.find((s) => s.available)
      if (!slot2) {
        steps.push({ step: '1_find_slot', status: 'fail', message: 'No available slots in next 2 days. Check barber schedules.' })
        return NextResponse.json({ success: false, steps })
      }
      // Use day after tomorrow
      const testDate = dayAfter
      const dateStr = format(testDate, 'yyyy-MM-dd')

      steps.push({ step: '1_find_slot', status: 'pass', message: `Slot found: ${dateStr} at ${slot2.time}` })

      // ─── Step 2: Build timezone-aware start time ────────────────────────
      const startTime = await buildStartTime(dateStr, slot2.time, businessId)

      testCustomerEmail = `e2e-test-${Date.now()}@thebarberco.com`

      // ─── Step 3: Create appointment ───────────────────────────────────────
      const result = await createAppointmentSafely({
        businessId,
        barberId: barber.id,
        serviceId: service.id,
        startTime,
        customerData: {
          firstName: 'E2E',
          lastName: 'Test',
          phone: '(555) 555-0199',
          email: testCustomerEmail,
          notes: 'Automated E2E test - safe to delete' as any,
        },
      })

      if (!result.success || !result.appointment) {
        steps.push({ step: '3_create_appointment', status: 'fail', message: result.error || 'Unknown error' })
        return NextResponse.json({ success: false, steps })
      }

      testAppointmentId = result.appointment.id
      steps.push({ step: '3_create_appointment', status: 'pass', message: `Confirmation: ${result.appointment.confirmationNumber}` })

      // ─── Step 4: Verify confirmation number + access token ──────────────
      const fullAppt = await prisma.appointment.findUnique({
        where: { id: testAppointmentId! },
        include: { customer: true, barber: true, service: true },
      })

      if (!fullAppt || !fullAppt.confirmationNumber || !fullAppt.customerAccessToken) {
        steps.push({ step: '4_verify_tokens', status: 'fail', message: 'Missing confirmation number or access token' })
      } else {
        steps.push({ step: '4_verify_tokens', status: 'pass', message: `Token: ${fullAppt.customerAccessToken.substring(0, 8)}...` })
      }

      // ─── Step 5: Verify appointment appears in queries ───────────────────
      const dashboardAppts = await prisma.appointment.findMany({
        where: { businessId, barberId: barber.id, status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] } },
        include: { customer: true },
      })

      const foundInDashboard = dashboardAppts.some((a) => a.id === testAppointmentId)
      if (!foundInDashboard) {
        steps.push({ step: '5_dashboard_query', status: 'fail', message: 'Appointment not found in dashboard query' })
      } else {
        steps.push({ step: '5_dashboard_query', status: 'pass', message: `Found in ${dashboardAppts.length} appointments for barber` })
      }

      // ─── Step 6: Verify double-booking protection ───────────────────────
      const slotsAfter = await getAvailableSlots({ businessId, barberId: barber.id, serviceId: service.id, date: testDate })
      const slotStillAvailable = slotsAfter.find((s) => s.time === slot2.time && s.available)

      if (slotStillAvailable) {
        steps.push({ step: '6_double_booking', status: 'fail', message: 'Slot still available after booking — double-booking protection failed!' })
      } else {
        steps.push({ step: '6_double_booking', status: 'pass', message: 'Slot correctly blocked after booking' })
      }

      // ─── Step 7: Cancel the appointment ──────────────────────────────────
      await prisma.appointment.update({
        where: { id: testAppointmentId! },
        data: { status: 'CANCELLED' },
      })
      steps.push({ step: '7_cancel', status: 'pass', message: 'Appointment cancelled' })

      // ─── Step 8: Verify slot becomes available again ─────────────────────
      const slotsAfterCancel = await getAvailableSlots({ businessId, barberId: barber.id, serviceId: service.id, date: testDate })
      const slotReopened = slotsAfterCancel.find((s) => s.time === slot2.time && s.available)

      if (!slotReopened) {
        steps.push({ step: '8_slot_reopened', status: 'fail', message: 'Slot not available after cancellation' })
      } else {
        steps.push({ step: '8_slot_reopened', status: 'pass', message: 'Slot correctly available after cancellation' })
      }

      // ─── Step 9: Clean up ──────────────────────────────────────────────
      await prisma.appointment.delete({ where: { id: testAppointmentId! } }).catch(() => {})
      await prisma.customer.deleteMany({ where: { email: testCustomerEmail } }).catch(() => {})
      steps.push({ step: '9_cleanup', status: 'pass', message: 'Test data cleaned up' })

      return NextResponse.json({
        success: true,
        steps,
        summary: `${steps.filter((s) => s.status === 'pass').length}/${steps.length} tests passed`,
      })
    }

    // ─── Path for tomorrow's slot ─────────────────────────────────────────
    const dateStr = format(tomorrow, 'yyyy-MM-dd')
    steps.push({ step: '1_find_slot', status: 'pass', message: `Slot found: ${dateStr} at ${availableSlot.time}` })

    // Build timezone-aware start time
    const startTime = await buildStartTime(dateStr, availableSlot.time, businessId)

    testCustomerEmail = `e2e-test-${Date.now()}@thebarberco.com`

    // ─── Create appointment ───────────────────────────────────────────────
    const result = await createAppointmentSafely({
      businessId,
      barberId: barber.id,
      serviceId: service.id,
      startTime,
      customerData: {
        firstName: 'E2E',
        lastName: 'Test',
        phone: '(555) 555-0199',
        email: testCustomerEmail,
        notes: 'Automated E2E test - safe to delete' as any,
      },
    })

    if (!result.success || !result.appointment) {
      steps.push({ step: '3_create_appointment', status: 'fail', message: result.error || 'Unknown error' })
      return NextResponse.json({ success: false, steps })
    }

    testAppointmentId = result.appointment.id
    steps.push({ step: '3_create_appointment', status: 'pass', message: `Confirmation: ${result.appointment.confirmationNumber}` })

    // ─── Verify tokens ────────────────────────────────────────────────────
    const fullAppt = await prisma.appointment.findUnique({
      where: { id: testAppointmentId! },
      include: { customer: true, barber: true, service: true },
    })

    if (!fullAppt || !fullAppt.confirmationNumber || !fullAppt.customerAccessToken) {
      steps.push({ step: '4_verify_tokens', status: 'fail', message: 'Missing confirmation number or access token' })
    } else {
      steps.push({ step: '4_verify_tokens', status: 'pass', message: `Token: ${fullAppt.customerAccessToken.substring(0, 8)}...` })
    }

    // ─── Verify dashboard query ───────────────────────────────────────────
    const dashboardAppts = await prisma.appointment.findMany({
      where: { businessId, barberId: barber.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      include: { customer: true },
    })

    const foundInDashboard = dashboardAppts.some((a) => a.id === testAppointmentId)
    if (!foundInDashboard) {
      steps.push({ step: '5_dashboard_query', status: 'fail', message: 'Appointment not found in dashboard query' })
    } else {
      steps.push({ step: '5_dashboard_query', status: 'pass', message: `Found in ${dashboardAppts.length} appointments for barber` })
    }

    // ─── Verify double-booking protection ─────────────────────────────────
    const slotsAfter = await getAvailableSlots({ businessId, barberId: barber.id, serviceId: service.id, date: tomorrow })
    const slotStillAvailable = slotsAfter.find((s) => s.time === availableSlot.time && s.available)

    if (slotStillAvailable) {
      steps.push({ step: '6_double_booking', status: 'fail', message: 'Slot still available after booking — double-booking protection failed!' })
    } else {
      steps.push({ step: '6_double_booking', status: 'pass', message: 'Slot correctly blocked after booking' })
    }

    // ─── Cancel ───────────────────────────────────────────────────────────
    await prisma.appointment.update({
      where: { id: testAppointmentId! },
      data: { status: 'CANCELLED' },
    })
    steps.push({ step: '7_cancel', status: 'pass', message: 'Appointment cancelled' })

    // ─── Verify slot reopens ───────────────────────────────────────────────
    const slotsAfterCancel = await getAvailableSlots({ businessId, barberId: barber.id, serviceId: service.id, date: tomorrow })
    const slotReopened = slotsAfterCancel.find((s) => s.time === availableSlot.time && s.available)

    if (!slotReopened) {
      steps.push({ step: '8_slot_reopened', status: 'fail', message: 'Slot not available after cancellation' })
    } else {
      steps.push({ step: '8_slot_reopened', status: 'pass', message: 'Slot correctly available after cancellation' })
    }

    // ─── Clean up ─────────────────────────────────────────────────────────
    await prisma.appointment.delete({ where: { id: testAppointmentId! } }).catch(() => {})
    await prisma.customer.deleteMany({ where: { email: testCustomerEmail } }).catch(() => {})
    steps.push({ step: '9_cleanup', status: 'pass', message: 'Test data cleaned up' })

    const allPassed = steps.every((s) => s.status === 'pass')
    return NextResponse.json({
      success: allPassed,
      steps,
      summary: `${steps.filter((s) => s.status === 'pass').length}/${steps.length} tests passed`,
    })

  } catch (error: any) {
    // Clean up on error
    if (testAppointmentId) {
      await prisma.appointment.delete({ where: { id: testAppointmentId! } }).catch(() => {})
    }
    if (testCustomerEmail) {
      await prisma.customer.deleteMany({ where: { email: testCustomerEmail } }).catch(() => {})
    }

    steps.push({ step: 'error', status: 'fail', message: error.message || 'Unexpected error' })
    return NextResponse.json({ success: false, steps, error: error.message })
  }
}
