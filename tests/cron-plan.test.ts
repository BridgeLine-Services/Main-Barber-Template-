/**
 * The scheduled-report switch and the plan-aware cron configuration.
 *
 * The point of these tests is that nothing here can silently change what runs. The Pro
 * schedule stays 15 minutes, Hobby has no sub-daily entry, vercel.json must match one of the
 * plan files, and the job does nothing unless the deployment explicitly switched it on.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ORGANIZATION_REPORT_CRON_FLAG,
  describeOrganizationReportCron,
  organizationReportCronEnabled,
  parseCronFlag,
} from '../src/lib/cron-flags'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const readText = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const REPORT = '/api/cron/organization-report-delivery'
const pro = read('config/vercel/crons.pro.json') as Array<{ path: string; schedule: string }>
const hobby = read('config/vercel/crons.hobby.json') as Array<{ path: string; schedule: string }>
const live = read('vercel.json').crons as Array<{ path: string; schedule: string }>

// The intended schedule is preserved exactly.
const proReport = pro.find((c) => c.path === REPORT)
ok('the Pro plan schedules the report job', Boolean(proReport))
ok('the Pro schedule is still every 15 minutes', proReport?.schedule === '*/15 * * * *', String(proReport?.schedule))

// Hobby cannot run sub-daily jobs, so it must not claim one.
ok('no Hobby schedule runs more than once a day', hobby.every((c) => !c.schedule.startsWith('*')))
ok('the Hobby plan has no report schedule at all', !hobby.some((c) => c.path === REPORT))
ok('the report job is not quietly turned into a daily job', !hobby.some((c) => c.path === REPORT))

// The deployed file is one of the plans, not a third hand-edited truth.
ok('vercel.json matches the Pro plan', JSON.stringify(live) === JSON.stringify(pro))

// Nothing else became frequent.
const subDaily = live.filter((c) => c.schedule.startsWith('*'))
ok('the report job is the only sub-daily schedule', subDaily.length === 1 && subDaily[0].path === REPORT, subDaily.map((c) => c.path).join(','))

// Every scheduled path is a route that exists, so no cron points at nothing.
const missing = live.filter((c) => !existsSync(join(ROOT, 'src/app', c.path, 'route.ts')))
ok('every scheduled path has a route', missing.length === 0, missing.map((c) => c.path).join(','))

// The maintenance report is scheduled now, daily, not frequently.
const maintenance = live.filter((c) => c.path === '/api/cron/maintenance-report')
ok('the maintenance report is scheduled once', maintenance.length === 1)
ok('the maintenance report runs daily', maintenance[0]?.schedule === '0 10 * * *', String(maintenance[0]?.schedule))

// --- the switch ------------------------------------------------------------
ok('only an explicit true switches it on', parseCronFlag('true'))
ok('true in capitals still counts', parseCronFlag('TRUE'))
ok('surrounding spaces are tolerated', parseCronFlag('  true  '))
ok('false is off', !parseCronFlag('false'))
ok('a missing value is off', !parseCronFlag(undefined))
ok('an empty value is off', !parseCronFlag(''))
ok('1 is not treated as true', !parseCronFlag('1'))
ok('yes is not treated as true', !parseCronFlag('yes'))
ok('a sentence is off', !parseCronFlag('true please'))
ok('the flag name is the documented one', ORGANIZATION_REPORT_CRON_FLAG === 'ORGANIZATION_REPORT_CRON_ENABLED')
ok('the environment switches it on', organizationReportCronEnabled({ ORGANIZATION_REPORT_CRON_ENABLED: 'true' } as never))
ok('an absent variable keeps it off', !organizationReportCronEnabled({} as never))
ok('a nonsense variable keeps it off', !organizationReportCronEnabled({ ORGANIZATION_REPORT_CRON_ENABLED: 'sure' } as never))
ok('the on state is described in words', /switched on/.test(describeOrganizationReportCron(true)))
ok('the off state says nothing is sent', /no report is sent/.test(describeOrganizationReportCron(false)))

// --- the route -------------------------------------------------------------
const route = readText('src/app/api/cron/organization-report-delivery/route.ts')
ok('the route checks the switch', route.includes('organizationReportCronEnabled()'))
ok('the switch is checked before any work', route.indexOf('organizationReportCronEnabled()') < route.indexOf('enqueueDueOrganizationReports()'))
ok('a disabled run answers success', route.includes('skipped: true'))
ok('the secret is still required when enabled', route.includes('CRON_SECRET'))
ok('a wrong secret is still refused', route.includes('status: 401'))
ok('nothing logs the secret', !/console\.(log|error)\([^)]*cronSecret/.test(route))

// --- idempotency -----------------------------------------------------------
const scheduled = readText('src/lib/organization/scheduled-report.ts')
ok('reports are enqueued with an idempotency key', scheduled.includes('organizationReportIdempotencyKey'))
ok('the key uses the configuration and the scheduled time', /organizationReportIdempotencyKey\(config\.id,\s*scheduledFor\)/.test(scheduled))

console.log(`\nCron plan and switch: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
