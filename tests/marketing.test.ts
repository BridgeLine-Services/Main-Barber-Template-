/**
 * Marketing audience segmentation tests — pure logic, no database.
 * Covers every campaign audience type, boundary thresholds, and the
 * once-per-campaign name resolution contract of matchAudienceCustomer.
 */
import { matchAudienceCustomer, AudienceCustomer } from '../src/lib/marketing'

const NOW = new Date('2026-09-13T15:00:00.000Z')

const day = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * day)
const daysAhead = (n: number) => new Date(NOW.getTime() + n * day)

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean) {
  if (condition) {
    passed++
  } else {
    failed++
    failures.push(name)
  }
}

function customer(appts: AudienceCustomer['appointments']): AudienceCustomer {
  return {
    id: 'cust-1',
    firstName: 'Alex',
    lastName: 'Taylor',
    phone: '+15550001111',
    email: 'alex@example.com',
    appointments: appts,
  }
}

const completed = (daysBack: number, extra: Partial<AudienceCustomer['appointments'][number]> = {}) => ({
  status: 'COMPLETED',
  startTime: daysAgo(daysBack),
  barber: extra.barber ?? { id: 'barber-1', name: 'Marco' },
  service: extra.service ?? { id: 'service-1', name: 'Classic Cut' },
  ...extra,
})

// ── INACTIVE_30/45/60/90 thresholds ─────────────────────────────────────────
{
  const c = customer([completed(45)])
  check('INACTIVE_30 matches at 45 days', matchAudienceCustomer(c, 'INACTIVE_30', NOW).matches === true)
  check('INACTIVE_45 matches at 45 days (boundary)', matchAudienceCustomer(c, 'INACTIVE_45', NOW).matches === true)
  check('INACTIVE_60 does not match at 45 days', matchAudienceCustomer(c, 'INACTIVE_60', NOW).matches === false)
  check('INACTIVE_90 does not match at 45 days', matchAudienceCustomer(c, 'INACTIVE_90', NOW).matches === false)

  const c29 = customer([completed(29)])
  check('INACTIVE_30 does not match at 29 days', matchAudienceCustomer(c29, 'INACTIVE_30', NOW).matches === false)

  const fresh = customer([completed(1)])
  check('INACTIVE_30 does not match a recent visit', matchAudienceCustomer(fresh, 'INACTIVE_30', NOW).matches === false)

  const never = customer([])
  check('INACTIVE_30 never matches with no completed visits', matchAudienceCustomer(never, 'INACTIVE_30', NOW).matches === false)

  const reason = matchAudienceCustomer(customer([completed(45)]), 'INACTIVE_60', NOW)
  check('inactive non-match carries no reason', reason.reason === '')

  const reasonHit = matchAudienceCustomer(customer([completed(61)]), 'INACTIVE_60', NOW)
  check('inactive match reason includes day count', reasonHit.matches === true && reasonHit.reason.includes('61 days'))
}

// ── INACTIVE uses the most recent COMPLETED visit, not the latest appt ──────
{
  const c = customer([
    completed(10, { status: 'CANCELLED' }), // newest appt, but cancelled
    completed(50),
  ])
  check('INACTIVE_45 ignores a newer cancelled appt (uses last completed)', matchAudienceCustomer(c, 'INACTIVE_45', NOW).matches === true)
}

// ── NOT_REBOOKED ────────────────────────────────────────────────────────────
{
  const withFuture = customer([completed(5), { status: 'CONFIRMED', startTime: daysAhead(3) } as any])
  check('NOT_REBOOKED does not match with a confirmed future appt', matchAudienceCustomer(withFuture, 'NOT_REBOOKED', NOW).matches === false)

  const withPastOnly = customer([completed(5), { status: 'CONFIRMED', startTime: daysAgo(1) } as any])
  check('NOT_REBOOKED matches when the only confirmed appt is in the past', matchAudienceCustomer(withPastOnly, 'NOT_REBOOKED', NOW).matches === true)

  const withPendingFuture = customer([completed(5), { status: 'PENDING', startTime: daysAhead(3) } as any])
  check('NOT_REBOOKED does not match with a pending future appt', matchAudienceCustomer(withPendingFuture, 'NOT_REBOOKED', NOW).matches === false)

  const neverVisited = customer([])
  check('NOT_REBOOKED never matches with no completed visits', matchAudienceCustomer(neverVisited, 'NOT_REBOOKED', NOW).matches === false)

  const cancelledOnly = customer([{ status: 'CANCELLED', startTime: daysAhead(3) } as any])
  check('NOT_REBOOKED never matches with no completed visits (cancelled future)', matchAudienceCustomer(cancelledOnly, 'NOT_REBOOKED', NOW).matches === false)
}

// ── CANCELLED / NO_SHOWED ───────────────────────────────────────────────────
{
  const c = customer([completed(5), { status: 'CANCELLED', startTime: daysAgo(3) } as any])
  const r = matchAudienceCustomer(c, 'CANCELLED', NOW)
  check('CANCELLED matches a customer with one cancellation', r.matches === true)
  check('CANCELLED reason is set', r.reason === 'Has cancelled an appointment')

  check('CANCELLED does not match without cancellations', matchAudienceCustomer(customer([completed(5)]), 'CANCELLED', NOW).matches === false)

  const ns = customer([completed(5), { status: 'NO_SHOW', startTime: daysAgo(3) } as any])
  const rns = matchAudienceCustomer(ns, 'NO_SHOWED', NOW)
  check('NO_SHOWED matches a customer with one no-show', rns.matches === true)
  check('NO_SHOWED reason is set', rns.reason === 'Has no-showed an appointment')

  check('NO_SHOWED does not match without no-shows', matchAudienceCustomer(customer([completed(5)]), 'NO_SHOWED', NOW).matches === false)
}

// ── NOT_VISITED_BARBER ──────────────────────────────────────────────────────
{
  const otherBarber = completed(10, { barber: { id: 'barber-2', name: 'Dee' } })
  const config = { barberId: 'barber-1', barberName: 'Marco' }

  const r = matchAudienceCustomer(customer([otherBarber]), 'NOT_VISITED_BARBER', NOW, config)
  check('NOT_VISITED_BARBER matches a customer who saw a different barber', r.matches === true)
  check('NOT_VISITED_BARBER reason uses the resolved barber name', r.reason === "Hasn't visited Marco")

  check(
    'NOT_VISITED_BARBER does not match a customer who did visit that barber',
    matchAudienceCustomer(customer([completed(10)]), 'NOT_VISITED_BARBER', NOW, config).matches === false
  )

  check(
    'NOT_VISITED_BARBER without barberId never matches',
    matchAudienceCustomer(customer([otherBarber]), 'NOT_VISITED_BARBER', NOW).matches === false
  )

  check(
    'NOT_VISITED_BARBER never matches with no completed visits',
    matchAudienceCustomer(customer([]), 'NOT_VISITED_BARBER', NOW, config).matches === false
  )

  const fallback = matchAudienceCustomer(customer([otherBarber]), 'NOT_VISITED_BARBER', NOW, { barberId: 'barber-1' })
  check('NOT_VISITED_BARBER falls back to "this barber" without a resolved name', fallback.reason === "Hasn't visited this barber")
}

// ── USED_SERVICE ───────────────────────────────────────────────────────────
{
  const otherService = completed(10, { service: { id: 'service-2', name: 'Beard Trim' } })
  const config = { serviceId: 'service-1', serviceName: 'Classic Cut' }

  const r = matchAudienceCustomer(customer([completed(10)]), 'USED_SERVICE', NOW, config)
  check('USED_SERVICE matches a customer who used the service', r.matches === true)
  check('USED_SERVICE reason uses the resolved service name', r.reason === 'Has used Classic Cut')

  check(
    'USED_SERVICE does not match a customer who used another service',
    matchAudienceCustomer(customer([otherService]), 'USED_SERVICE', NOW, config).matches === false
  )

  check(
    'USED_SERVICE ignores non-completed uses (cancelled appt does not count)',
    matchAudienceCustomer(customer([{ status: 'CANCELLED', startTime: daysAgo(5), service: { id: 'service-1', name: 'Classic Cut' } } as any]), 'USED_SERVICE', NOW, config).matches === false
  )

  check(
    'USED_SERVICE without serviceId never matches',
    matchAudienceCustomer(customer([completed(10)]), 'USED_SERVICE', NOW).matches === false
  )
}

// ── ALL_CUSTOMERS and unknown audiences ─────────────────────────────────────
{
  const r = matchAudienceCustomer(customer([]), 'ALL_CUSTOMERS', NOW)
  check('ALL_CUSTOMERS matches everyone', r.matches === true)
  check('ALL_CUSTOMERS reason is set', r.reason === 'All customers')

  check('unknown audience never matches', matchAudienceCustomer(customer([completed(1)]), 'NOT_A_REAL_AUDIENCE', NOW).matches === false)
  check('BIRTHDAY_MONTH is a no-op without a schema field', matchAudienceCustomer(customer([completed(1)]), 'BIRTHDAY_MONTH', NOW).matches === false)
}

// ── Reason is empty on every non-match ──────────────────────────────────────
{
  const audiences = ['INACTIVE_30', 'INACTIVE_90', 'NOT_REBOOKED', 'CANCELLED', 'NO_SHOWED', 'NOT_VISITED_BARBER', 'USED_SERVICE']
  for (const audience of audiences) {
    const r = matchAudienceCustomer(customer([]), audience, NOW, { barberId: 'barber-1', serviceId: 'service-1' })
    check(`non-match carries no reason (${audience})`, r.matches === false && r.reason === '')
  }
}

// ── ISO string dates are accepted alongside Date objects ────────────────────
{
  const c = customer([{ status: 'COMPLETED', startTime: daysAgo(40).toISOString() } as any])
  check('ISO string startTime works for INACTIVE_30', matchAudienceCustomer(c, 'INACTIVE_30', NOW).matches === true)
}

console.log(`Marketing audience tests: ${passed} passed, ${failed} failed`)
if (failures.length) {
  console.log('Failures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
