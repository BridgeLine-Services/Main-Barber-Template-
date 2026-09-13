import { prisma } from '@/lib/prisma'

// ============================================================================
// Marketing Automation Engine
// Owner creates targeted campaigns based on customer segments.
// Audiences: inactive 30/45/60/90 days, not rebooked, cancelled, no-showed,
// birthday month, haven't visited a barber, used a specific service.
// ============================================================================

export interface CampaignTarget {
  customerId: string
  firstName: string
  lastName: string
  phone: string
  email: string
  reason: string // why they matched this audience
}

/**
 * Minimal customer shape needed for pure audience matching. Dates may be
 * Date objects or ISO strings; appointments are pre-sorted newest-first.
 */
export interface AudienceCustomer {
  id: string
  firstName: string
  lastName: string
  phone: string
  email: string
  appointments: Array<{
    status: string
    startTime: Date | string
    barber?: { id: string; name: string } | null
    service?: { id: string; name: string } | null
  }>
}

/**
 * Resolve a campaign audience to a list of targeted customers.
 */
export async function resolveCampaignAudience(
  businessId: string,
  audience: string,
  audienceConfig?: {
    barberId?: string
    serviceId?: string
  }
): Promise<CampaignTarget[]> {
  const now = new Date()

  // Resolve display names once per campaign — not once per customer.
  let barberName: string | undefined
  let serviceName: string | undefined
  if (audience === 'NOT_VISITED_BARBER' && audienceConfig?.barberId) {
    const barber = await prisma.barber.findUnique({ where: { id: audienceConfig.barberId }, select: { name: true } })
    barberName = barber?.name
  }
  if (audience === 'USED_SERVICE' && audienceConfig?.serviceId) {
    const service = await prisma.service.findUnique({ where: { id: audienceConfig.serviceId }, select: { name: true } })
    serviceName = service?.name
  }

  // Base query: all customers for this business
  const customers = await prisma.customer.findMany({
    where: { businessId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      appointments: {
        include: {
          barber: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
        },
        orderBy: { startTime: 'desc' },
      },
    },
  })

  const targets: CampaignTarget[] = []
  for (const customer of customers) {
    const { matches, reason } = matchAudienceCustomer(
      customer as unknown as AudienceCustomer,
      audience,
      now,
      { ...audienceConfig, barberName, serviceName }
    )
    if (matches) {
      targets.push({
        customerId: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email,
        reason,
      })
    }
  }

  return targets
}

/**
 * Pure audience-matching predicate for one customer.
 *
 * Exported for testing — no database access. The caller pre-resolves
 * barber/service display names (once per campaign, not per customer) so
 * this stays synchronous.
 */
export function matchAudienceCustomer(
  customer: AudienceCustomer,
  audience: string,
  now: Date,
  audienceConfig?: {
    barberId?: string
    serviceId?: string
    barberName?: string
    serviceName?: string
  }
): { matches: boolean; reason: string } {
  const appts = customer.appointments ?? []
  const completedAppts = appts.filter(a => a.status === 'COMPLETED')
  const lastAppt = completedAppts[0]
  const lastApptDate = lastAppt ? new Date(lastAppt.startTime) : null
  const daysSinceLast = lastApptDate
    ? Math.floor((now.getTime() - lastApptDate.getTime()) / (1000 * 60 * 60 * 24))
    : null

  switch (audience) {
    case 'INACTIVE_30':
    case 'INACTIVE_45':
    case 'INACTIVE_60':
    case 'INACTIVE_90': {
      const threshold = Number(audience.slice('INACTIVE_'.length))
      const matches = daysSinceLast !== null && daysSinceLast >= threshold
      return { matches, reason: matches ? `Inactive for ${daysSinceLast} days` : '' }
    }

    case 'NOT_REBOOKED': {
      // Has completed appointments but no pending/confirmed future ones
      const matches =
        completedAppts.length > 0 &&
        !appts.some(
          a => ['PENDING', 'CONFIRMED'].includes(a.status) && new Date(a.startTime) > now
        )
      return { matches, reason: matches ? 'Has not rebooked after last visit' : '' }
    }

    case 'CANCELLED': {
      const matches = appts.some(a => a.status === 'CANCELLED')
      return { matches, reason: matches ? 'Has cancelled an appointment' : '' }
    }

    case 'NO_SHOWED': {
      const matches = appts.some(a => a.status === 'NO_SHOW')
      return { matches, reason: matches ? 'Has no-showed an appointment' : '' }
    }

    case 'BIRTHDAY_MONTH':
      // Would need a birthday field on Customer — not currently in the schema.
      return { matches: false, reason: '' }

    case 'NOT_VISITED_BARBER': {
      const barberId = audienceConfig?.barberId
      if (!barberId) return { matches: false, reason: '' }
      const matches =
        completedAppts.length > 0 && !completedAppts.some(a => a.barber?.id === barberId)
      return {
        matches,
        reason: matches ? `Hasn't visited ${audienceConfig?.barberName || 'this barber'}` : '',
      }
    }

    case 'USED_SERVICE': {
      const serviceId = audienceConfig?.serviceId
      if (!serviceId) return { matches: false, reason: '' }
      const matches = completedAppts.some(a => a.service?.id === serviceId)
      return {
        matches,
        reason: matches ? `Has used ${audienceConfig?.serviceName || 'this service'}` : '',
      }
    }

    case 'ALL_CUSTOMERS':
      return { matches: true, reason: 'All customers' }

    default:
      return { matches: false, reason: '' }
  }
}

/**
 * Create a marketing campaign record.
 */
export async function createCampaign(businessId: string, data: {
  name: string
  subject: string
  body: string
  audience: string
  audienceConfig?: any
  createdBy?: string
}) {
  const campaign = await prisma.marketingCampaign.create({
    data: {
      businessId,
      name: data.name,
      subject: data.subject,
      body: data.body,
      audience: data.audience as any,
      audienceConfig: data.audienceConfig || undefined,
      status: 'DRAFT',
    },
  })

  // Audit log
  try {
    await prisma.auditLog.create({
      data: {
        businessId,
        userId: data.createdBy,
        action: 'CAMPAIGN_CREATED',
        entityType: 'MarketingCampaign',
        entityId: campaign.id,
        newValues: { name: data.name, audience: data.audience },
      },
    })
  } catch (e) {
    // Non-critical
  }

  return campaign
}

/**
 * Send a campaign to all matching customers.
 */
export async function sendCampaign(businessId: string, campaignId: string) {
  const campaign = await prisma.marketingCampaign.findFirst({
    where: { id: campaignId, businessId },
  })

  if (!campaign) throw new Error('Campaign not found')

  const targets = await resolveCampaignAudience(businessId, campaign.audience, campaign.audienceConfig as any)

  // Log each notification
  for (const target of targets) {
    try {
      await prisma.notificationLog.create({
        data: {
          appointmentId: null,
          channel: 'SMS',
          type: 'MARKETING_CAMPAIGN',
          recipient: target.phone,
          content: `${campaign.subject}\n\n${campaign.body}`,
          status: 'PENDING',
          businessId,
        },
      })
    } catch (e) {
      // Non-critical — continue sending to others
    }
  }

  // Update campaign status
  await prisma.marketingCampaign.update({
    where: { id: campaignId },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      recipientCount: targets.length,
    },
  })

  // Audit log
  try {
    await prisma.auditLog.create({
      data: {
        businessId,
        action: 'CAMPAIGN_SENT',
        entityType: 'MarketingCampaign',
        entityId: campaignId,
        newValues: { recipientCount: targets.length },
      },
    })
  } catch (e) {
    // Non-critical
  }

  return { sent: targets.length }
}
