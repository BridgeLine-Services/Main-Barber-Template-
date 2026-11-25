import { DateTime } from 'luxon'
import { prisma } from '@/lib/prisma'
import { buildConfigAuditEntry } from './config-audit'
import { aggregateOnlyGuard } from './privacy'
import { loadLocationRefs, loadLocationRollup } from './report-query'
import { buildOrganizationReport, type OrganizationReport } from './reporting'
import { organizationReportIdempotencyKey } from './report-delivery'

export const ORGANIZATION_AGGREGATE_REPORT_METRIC = 'aggregate_report'
export type OrganizationReportFrequency = 'daily' | 'weekly' | 'monthly'
export type OrganizationReportPeriod = 7 | 30 | 90

const REPORT_HOUR = 9

async function recordReportPreparationFailure(
  configuration: { id: string; organizationId: string },
  scheduledFor: Date,
  nextRunAt: Date | null,
  at: Date,
  disableSchedule = false,
) {
  try {
    const result = await prisma.organizationReportingConfiguration.updateMany({
      where: { id: configuration.id, enabled: true, nextRunAt: scheduledFor },
      data: {
        enabled: disableSchedule ? false : true,
        nextRunAt,
        lastDeliveryStatus: 'FAILED',
        lastDeliveryAt: at,
        lastDeliveryError: disableSchedule
          ? 'Schedule settings need review before another report can be sent.'
          : 'The report could not be prepared; no email was sent.',
      },
    })
    if (result.count !== 1) return
    await prisma.organizationConfigAudit.create({
      data: buildConfigAuditEntry({
        organizationId: configuration.organizationId,
        actorId: null,
        action: 'organization-report.prepare.failed',
        entity: 'OrganizationReportingConfiguration',
        entityId: configuration.id,
        summary: 'Scheduled organization report could not be prepared; no email was sent.',
        previousValue: { status: 'PENDING' },
        newValue: { status: 'FAILED' },
        at: at.toISOString(),
      }),
    })
  } catch {
    console.error('[organization-report] could not record report preparation failure')
  }
}

export function nextOrganizationReportAt(
  frequency: string,
  timeZone: string,
  from: Date = new Date(),
): Date | null {
  const localNow = DateTime.fromJSDate(from, { zone: timeZone })
  if (!localNow.isValid) return null

  const atNine = (date: DateTime) => date.set({ hour: REPORT_HOUR, minute: 0, second: 0, millisecond: 0 })
  let candidate: DateTime

  if (frequency === 'daily') {
    candidate = atNine(localNow)
    if (candidate <= localNow) candidate = candidate.plus({ days: 1 })
  } else if (frequency === 'weekly') {
    const daysUntilMonday = (8 - localNow.weekday) % 7
    candidate = atNine(localNow.startOf('day').plus({ days: daysUntilMonday }))
    if (candidate <= localNow) candidate = candidate.plus({ days: 7 })
  } else if (frequency === 'monthly') {
    candidate = atNine(localNow.startOf('month'))
    if (candidate <= localNow) candidate = atNine(localNow.plus({ months: 1 }).startOf('month'))
  } else {
    return null
  }

  return candidate.toUTC().toJSDate()
}

function formatCount(value: number | null | undefined): string {
  return value == null ? 'Unavailable' : new Intl.NumberFormat('en-US').format(value)
}

function formatMoney(value: number | null | undefined): string {
  return value == null
    ? 'Unavailable'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100)
}

export function buildOrganizationReportEmail(report: OrganizationReport): string {
  const totals = report.totals
  return [
    `Organization business summary for ${report.rangeLabel}`,
    `Locations included: ${formatCount(report.locations.length)}`,
    '',
    `Appointments booked: ${formatCount(totals.appointments)}`,
    `Appointments completed: ${formatCount(totals.completed)}`,
    `Appointments cancelled: ${formatCount(totals.cancelled)}`,
    `New customers: ${formatCount(totals.newCustomers)}`,
    `Returning customers: ${formatCount(totals.returningCustomers)}`,
    '',
    `Gross revenue: ${formatMoney(totals.grossRevenueCents)}`,
    `Refunds: ${formatMoney(totals.refundsCents)}`,
    `Net revenue: ${formatMoney(totals.netRevenueCents)}`,
    `Staff commissions: ${formatMoney(totals.commissionsCents)}`,
    `Recorded expenses: ${formatMoney(totals.recordedExpensesCents)}`,
    '',
    'No customer names, contact details, appointment histories, or profit estimate are included.',
    'Some totals may be unavailable when one or more location figures could not be verified.',
  ].join('\n')
}

function periodRange(now: Date, days: number) {
  return {
    start: new Date(now.getTime() - days * 86_400_000),
    end: now,
    label: `the last ${days} days`,
  }
}

export async function enqueueDueOrganizationReports(now: Date = new Date()) {
  const due = await prisma.organizationReportingConfiguration.findMany({
    where: {
      metric: ORGANIZATION_AGGREGATE_REPORT_METRIC,
      enabled: true,
      nextRunAt: { lte: now },
    },
    select: {
      id: true,
      organizationId: true,
      schedule: true,
      recipients: true,
      reportingPeriodDays: true,
      timeZone: true,
      deliveryMethod: true,
      nextRunAt: true,
    },
  })

  let queued = 0
  let failed = 0
  let skipped = 0

  for (const config of due) {
    const scheduledFor = config.nextRunAt
    if (!scheduledFor) {
      skipped += 1
      continue
    }

    const nextRunAt = nextOrganizationReportAt(config.schedule, config.timeZone, now)
    if (!nextRunAt) {
      await recordReportPreparationFailure(config, scheduledFor, null, now, true)
      failed += 1
      continue
    }

    try {
      if (config.deliveryMethod !== 'EMAIL' || !config.recipients[0]) {
        throw new Error('Report delivery settings are incomplete.')
      }

      const locations = await prisma.organizationLocation.findMany({
        where: { organizationId: config.organizationId },
        select: { businessId: true },
      })
      const refs = await loadLocationRefs(locations.map((location) => location.businessId))
      const range = periodRange(now, config.reportingPeriodDays)
      const rollups = await Promise.all(
        refs.map((ref) => loadLocationRollup(ref, { start: range.start, end: range.end, label: range.label })),
      )
      const report = buildOrganizationReport(config.organizationId, rollups, {
        generatedAt: now.toISOString(),
        rangeLabel: range.label,
      })
      const privacy = aggregateOnlyGuard(report)
      if (!privacy.safe) throw new Error('Aggregate report privacy check failed.')

      const created = await prisma.$transaction(async (transaction) => {
        const claim = await transaction.organizationReportingConfiguration.updateMany({
          where: { id: config.id, enabled: true, nextRunAt: scheduledFor },
          data: {
            nextRunAt,
            lastDeliveryStatus: 'PENDING',
            lastDeliveryError: null,
          },
        })
        if (claim.count !== 1) return false

        await transaction.notificationLog.create({
          data: {
            organizationReportingConfigurationId: config.id,
            type: 'ORGANIZATION_REPORT',
            channel: 'EMAIL',
            recipient: config.recipients[0],
            subject: `Organization business summary — ${range.label}`,
            content: buildOrganizationReportEmail(report),
            status: 'PENDING',
            scheduledAt: now,
            idempotencyKey: organizationReportIdempotencyKey(config.id, scheduledFor),
          },
        })
        return true
      })

      if (created) queued += 1
      else skipped += 1
    } catch {
      await recordReportPreparationFailure(config, scheduledFor, nextRunAt, now)
      failed += 1
    }
  }

  return { due: due.length, queued, failed, skipped }
}
