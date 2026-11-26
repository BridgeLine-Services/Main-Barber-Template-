/**
 * Scheduled-job switches (Section 4 of the platform brief).
 *
 * A deployment on a plan that cannot run sub-daily cron jobs must still ship the code that
 * does the work. The schedule stays in configuration; this flag decides whether the route
 * acts when it is called. Missing or unrecognised values mean disabled: a scheduled job that
 * nobody switched on should not start sending reports.
 *
 * Read on the server only. Nothing here is exposed to the browser, and no request can turn a
 * job on: only the deployment environment can.
 */

export const ORGANIZATION_REPORT_CRON_FLAG = 'ORGANIZATION_REPORT_CRON_ENABLED'

/** True only for an explicit "true". Everything else, including nonsense, is off. */
export function parseCronFlag(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false
  return raw.trim().toLowerCase() === 'true'
}

export function organizationReportCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseCronFlag(env[ORGANIZATION_REPORT_CRON_FLAG])
}

/** A sentence the settings or operations screen can show without guessing. */
export function describeOrganizationReportCron(enabled: boolean): string {
  return enabled
    ? 'Scheduled organization reports are switched on. The job runs when the schedule calls it.'
    : 'Scheduled organization reports are switched off. The job answers but does nothing, and no report is sent.'
}
