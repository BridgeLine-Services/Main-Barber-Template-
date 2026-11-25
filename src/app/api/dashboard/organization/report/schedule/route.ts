import { DateTime } from 'luxon'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { buildConfigAuditEntry, summariseConfigChange } from '@/lib/organization/config-audit'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import {
  nextOrganizationReportAt,
  ORGANIZATION_AGGREGATE_REPORT_METRIC,
} from '@/lib/organization/scheduled-report'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  periodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  timeZone: z.string().trim().min(1).max(100),
  recipientEmail: z.string().trim().max(254).email().or(z.literal('')),
  deliveryMethod: z.literal('EMAIL'),
})

async function authorizeReportManager() {
  const auth = await requireAuth()
  if (!auth.success) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return { response: NextResponse.json({ error: 'Organization access required' }, { status: 403 }) }
  }

  const { context } = resolved
  const canManage = can(context.role, 'reporting.aggregate.read') &&
    (context.role === 'ORGANIZATION_OWNER' || context.role === 'CORPORATE_ADMIN')
  if (!canManage) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { organizationId: context.organizationId, userId: auth.user.id }
}

function serializeSchedule(config: {
  enabled: boolean
  schedule: string
  reportingPeriodDays: number
  timeZone: string
  deliveryMethod: string
  recipients: string[]
  nextRunAt: Date | null
  lastDeliveryStatus: string | null
  lastDeliveryAt: Date | null
  lastDeliveryError: string | null
} | null) {
  return {
    enabled: config?.enabled ?? false,
    frequency: config?.schedule ?? 'weekly',
    periodDays: config?.reportingPeriodDays ?? 7,
    timeZone: config?.timeZone ?? 'UTC',
    deliveryMethod: config?.deliveryMethod ?? 'EMAIL',
    recipientEmail: config?.recipients[0] ?? '',
    nextRunAt: config?.nextRunAt?.toISOString() ?? null,
    lastDeliveryStatus: config?.lastDeliveryStatus ?? null,
    lastDeliveryAt: config?.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryError: config?.lastDeliveryError ?? null,
  }
}

export async function GET() {
  const authorization = await authorizeReportManager()
  if ('response' in authorization) return authorization.response

  try {
    const config = await prisma.organizationReportingConfiguration.findUnique({
      where: {
        organizationId_metric: {
          organizationId: authorization.organizationId,
          metric: ORGANIZATION_AGGREGATE_REPORT_METRIC,
        },
      },
      select: {
        enabled: true,
        schedule: true,
        reportingPeriodDays: true,
        timeZone: true,
        deliveryMethod: true,
        recipients: true,
        nextRunAt: true,
        lastDeliveryStatus: true,
        lastDeliveryAt: true,
        lastDeliveryError: true,
      },
    })
    return NextResponse.json({ schedule: serializeSchedule(config) })
  } catch {
    return NextResponse.json({ error: 'Report settings are temporarily unavailable.' }, { status: 503 })
  }
}

export async function PUT(request: Request) {
  const authorization = await authorizeReportManager()
  if ('response' in authorization) return authorization.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Check the schedule settings and try again.' }, { status: 400 })

  const value = parsed.data
  const zone = DateTime.now().setZone(value.timeZone)
  if (!zone.isValid) return NextResponse.json({ error: 'Enter a valid IANA time zone.' }, { status: 400 })
  if (value.enabled && !value.recipientEmail) {
    return NextResponse.json({ error: 'Add a report recipient before enabling delivery.' }, { status: 400 })
  }

  const recipientEmail = value.recipientEmail.trim()
  const nextRunAt = value.enabled
    ? nextOrganizationReportAt(value.frequency, value.timeZone, new Date())
    : null
  if (value.enabled && !nextRunAt) {
    return NextResponse.json({ error: 'The schedule settings are not valid.' }, { status: 400 })
  }

  try {
    const config = await prisma.$transaction(async (transaction) => {
      const where = {
        organizationId_metric: {
          organizationId: authorization.organizationId,
          metric: ORGANIZATION_AGGREGATE_REPORT_METRIC,
        },
      }
      const existing = await transaction.organizationReportingConfiguration.findUnique({ where })
      const recipients = recipientEmail ? [recipientEmail] : existing?.recipients ?? []
      const saved = await transaction.organizationReportingConfiguration.upsert({
        where,
        create: {
          organizationId: authorization.organizationId,
          metric: ORGANIZATION_AGGREGATE_REPORT_METRIC,
          enabled: value.enabled,
          schedule: value.frequency,
          recipients,
          reportingPeriodDays: value.periodDays,
          timeZone: value.timeZone,
          deliveryMethod: value.deliveryMethod,
          nextRunAt,
        },
        update: {
          enabled: value.enabled,
          schedule: value.frequency,
          recipients,
          reportingPeriodDays: value.periodDays,
          timeZone: value.timeZone,
          deliveryMethod: value.deliveryMethod,
          nextRunAt,
        },
      })

      const auditValue = {
        enabled: saved.enabled,
        frequency: saved.schedule,
        periodDays: saved.reportingPeriodDays,
        timeZone: saved.timeZone,
        deliveryMethod: saved.deliveryMethod,
        recipientConfigured: saved.recipients.length > 0,
      }
      const beforeValue = existing ? {
        enabled: existing.enabled,
        frequency: existing.schedule,
        periodDays: existing.reportingPeriodDays,
        timeZone: existing.timeZone,
        deliveryMethod: existing.deliveryMethod,
        recipientConfigured: existing.recipients.length > 0,
      } : null
      const change = summariseConfigChange(beforeValue, auditValue)
      let responseConfig = saved
      if (!existing || change.changedFields.length > 0) {
        await transaction.organizationConfigAudit.create({
          data: buildConfigAuditEntry({
            organizationId: authorization.organizationId,
            actorId: authorization.userId,
            action: 'organization-report.schedule.updated',
            entity: 'OrganizationReportingConfiguration',
            entityId: saved.id,
            summary: `Scheduled organization report settings saved. ${change.headline}`,
            previousValue: beforeValue,
            newValue: auditValue,
            at: new Date().toISOString(),
          }),
        })
      }

      if (existing && change.changedFields.length > 0) {
        const cancellationMessage = 'Report delivery was cancelled because the schedule settings changed before sending.'
        const cancelled = await transaction.notificationLog.updateMany({
          where: { organizationReportingConfigurationId: saved.id, status: 'PENDING' },
          data: { status: 'FAILED', errorMessage: cancellationMessage, failureReason: cancellationMessage },
        })
        if (cancelled.count > 0) {
          const cancelledAt = new Date()
          responseConfig = await transaction.organizationReportingConfiguration.update({
            where: { id: saved.id },
            data: {
              lastDeliveryStatus: 'CANCELLED',
              lastDeliveryAt: cancelledAt,
              lastDeliveryError: cancellationMessage,
            },
          })
          await transaction.organizationConfigAudit.create({
            data: buildConfigAuditEntry({
              organizationId: authorization.organizationId,
              actorId: authorization.userId,
              action: 'organization-report.delivery.cancelled',
              entity: 'OrganizationReportingConfiguration',
              entityId: saved.id,
              summary: `Cancelled ${cancelled.count} queued report email(s) after schedule settings changed.`,
              previousValue: { status: 'PENDING', count: cancelled.count },
              newValue: { status: 'CANCELLED' },
              at: cancelledAt.toISOString(),
            }),
          })
        }
      }

      return responseConfig
    })
    return NextResponse.json({ schedule: serializeSchedule(config) })
  } catch {
    return NextResponse.json({ error: 'Report settings could not be saved.' }, { status: 503 })
  }
}
