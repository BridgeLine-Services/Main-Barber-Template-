import { prisma } from '@/lib/prisma'
import { getCustomerIntelligence } from '@/lib/customer-intelligence'
import { buildRebookingIdempotencyKey, buildRebookingMessage } from '@/lib/retention'
import { queueCustomerNotification } from '@/lib/notifications'

// ============================================================================
// Automated Rebooking Engine
// Analyzes completed appointments, predicts when customers are due for their
// next appointment, and creates rebooking tasks/reminders.
// ============================================================================

export interface RebookingTask {
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  lastVisit: Date
  averageIntervalDays: number
  predictedNextDate: Date
  daysOverdue: number
  intelligence: {
    favoriteBarberName: string | null
    favoriteServiceName: string | null
    visitCount: number
    lifetimeValue: number
  }
}

/**
 * Scan all customers for a business and identify those who are due for rebooking.
 * A customer is "due" if today's date is at or past their predicted next appointment date.
 */
export async function getRebookingTasks(businessId: string): Promise<RebookingTask[]> {
  // Get all customers who have at least one completed appointment
  const customers = await prisma.customer.findMany({
    where: {
      businessId,
      appointments: {
        some: { status: 'COMPLETED' },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      appointments: {
        where: { status: 'COMPLETED' },
        include: {
          barber: { select: { name: true } },
          service: { select: { name: true, price: true } },
        },
        orderBy: { startTime: 'desc' },
      },
    },
  })

  const tasks: RebookingTask[] = []
  const now = new Date()

  for (const customer of customers) {
    const intelligence = await getCustomerIntelligence(customer.id, businessId)

    if (!intelligence.isDueForRebook || !intelligence.nextPredictedDate) continue

    // Check if there's already a pending/confirmed appointment in the future
    const futureAppt = await prisma.appointment.findFirst({
      where: {
        customerId: customer.id,
        businessId,
        status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
        startTime: { gte: now },
      },
    })

    if (futureAppt) continue // Already has an upcoming appointment

    const daysOverdue = Math.round(
      (now.getTime() - intelligence.nextPredictedDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    tasks.push({
      customerId: customer.id,
      customerName: `${customer.firstName} ${customer.lastName}`,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      lastVisit: intelligence.lastVisit!,
      averageIntervalDays: intelligence.averageIntervalDays || 21,
      predictedNextDate: intelligence.nextPredictedDate,
      daysOverdue,
      intelligence: {
        favoriteBarberName: intelligence.favoriteBarber?.name || null,
        favoriteServiceName: intelligence.favoriteService?.name || null,
        visitCount: intelligence.visitCount,
        lifetimeValue: intelligence.lifetimeValue,
      },
    })
  }

  // Sort: most overdue first
  tasks.sort((a, b) => b.daysOverdue - a.daysOverdue)

  return tasks
}

/**
 * Send a rebooking reminder to a customer (creates a notification record).
 * This is the manual trigger — eventually this could be automated via a cron job.
 */
export async function sendRebookingReminder(
  businessId: string,
  customerId: string,
  channel: 'SMS' | 'EMAIL' = 'SMS'
): Promise<{ success: boolean; message: string }> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, smsConsent: true },
  })

  if (!customer) return { success: false, message: 'Customer not found' }

  if (channel === 'SMS' && !customer.smsConsent) {
    return { success: false, message: 'Customer has not consented to SMS notifications' }
  }

  const intelligence = await getCustomerIntelligence(customerId, businessId)
  const barberName = intelligence.favoriteBarber?.name || 'your preferred barber'
  const serviceName = intelligence.favoriteService?.name || 'your usual service'

  const referenceDate = intelligence.nextPredictedDate || new Date()
  const bookingUrl = `/book?customer=${encodeURIComponent(customer.id)}`
  const content = buildRebookingMessage(customer.firstName, serviceName, barberName, bookingUrl)
  const recipient = channel === 'EMAIL' ? customer.email : customer.phone

  try {
    const result = await queueCustomerNotification({
      businessId,
      customerId: customer.id,
      recipient,
      channel,
      type: 'REBOOKING_REMINDER',
      content,
      idempotencyKey: buildRebookingIdempotencyKey(customer.id, channel, referenceDate),
      smsConsent: customer.smsConsent,
    })

    if (!result.queued) return { success: false, message: result.reason || 'Notification was not queued' }

    return {
      success: true,
      message: `Rebooking reminder queued for ${customer.firstName} ${customer.lastName} via ${channel}`,
    }
  } catch (e) {
    console.error('[rebooking] failed to queue reminder', e)
    return { success: false, message: 'Failed to queue reminder' }
  }
}
