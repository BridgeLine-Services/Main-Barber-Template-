import {
  buildSlowDayReport,
  groupByShopDay,
  slowDayCard,
  weekdayOf,
  WEEKDAY_NAMES,
  recentWindow,
  SLOW_DAY_WINDOW_WEEKS,
} from '../src/lib/growth/slow-days'

let p = 0
const failures: string[] = []
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) p++
  else failures.push(name + (detail ? ' — ' + detail : ''))
}

/** Four Sundays, four Tuesdays, four Thursdays: Tuesday is the quiet one. */
const EVEN_THEN_QUIET = [
  '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', // Sundays
  '2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24', // Tuesdays
  '2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26', // Thursdays
]

function daysFor(plan: Record<number, number>): { date: string; booked: number }[] {
  // plan maps weekday index to bookings per occurrence; dates above repeat every 7 days
  return EVEN_THEN_QUIET.map((date) => ({ date, booked: plan[weekdayOf(date)] ?? 0 }))
}

const quietTuesday = buildSlowDayReport({ days: daysFor({ 0: 8, 2: 2, 4: 8 }) })
ok('a quiet weekday is found', quietTuesday.findings.length === 1, JSON.stringify(quietTuesday.findings))
ok('it names the right day', quietTuesday.findings[0]?.name === 'Tuesday', quietTuesday.findings[0]?.name)
ok('it counts the occurrences', quietTuesday.findings[0]?.occurrences === 4)
ok('the state asks for attention', quietTuesday.state === 'needs-attention')
ok('the headline names the day', /Tuesday is your quietest day/.test(quietTuesday.headline), quietTuesday.headline)
ok('the basis states the evidence', /Across 4 Tuesdays you booked about 2 people a day/.test(quietTuesday.detail), quietTuesday.detail)
ok('the basis states the comparison', /against 6 on an average day/.test(quietTuesday.detail), quietTuesday.detail)
ok('the percentage is computed', quietTuesday.findings[0]?.percentBelow === 67, String(quietTuesday.findings[0]?.percentBelow))

// An even week must never be called quiet
const evenWeek = buildSlowDayReport({ days: daysFor({ 0: 6, 2: 6, 4: 6 }) })
ok('an even week has no findings', evenWeek.findings.length === 0)
ok('an even week is healthy', evenWeek.state === 'healthy')
ok('an even week says so plainly', /fairly even/.test(evenWeek.headline))
ok('an even week has no action', evenWeek.action === null)

// Rounding noise must not be called a slow day
const tinyShop = buildSlowDayReport({
  days: [
    { date: '2026-11-01', booked: 1 }, { date: '2026-11-08', booked: 1 }, { date: '2026-11-15', booked: 1 },
    { date: '2026-11-03', booked: 0 }, { date: '2026-11-10', booked: 0 }, { date: '2026-11-17', booked: 0 },
  ],
})
ok('a sub-one-booking gap is not a quiet day', tinyShop.findings.length === 0, JSON.stringify(tinyShop.findings))
ok('that shop is called even, not broken', tinyShop.state === 'healthy')

// Not enough history for a weekday
const shortHistory = buildSlowDayReport({
  days: [
    { date: '2026-11-01', booked: 9 }, { date: '2026-11-08', booked: 9 },
    { date: '2026-11-03', booked: 1 }, { date: '2026-11-10', booked: 1 },
  ],
})
ok('two occurrences are not judged', shortHistory.findings.length === 0)
ok('it explains the threshold', /at least 3 times/.test(shortHistory.detail), shortHistory.detail)
ok('short history is not a failure', shortHistory.state === 'not-configured')

const twoOfThree = buildSlowDayReport({
  days: [
    { date: '2026-11-01', booked: 9 }, { date: '2026-11-08', booked: 9 }, { date: '2026-11-15', booked: 9 },
    { date: '2026-11-03', booked: 1 }, { date: '2026-11-10', booked: 1 }, { date: '2026-11-17', booked: 1 },
  ],
  minOccurrences: 3,
})
ok('three occurrences are judged', twoOfThree.findings.length === 1, JSON.stringify(twoOfThree.findings))
ok('the threshold is configurable', buildSlowDayReport({ days: twoOfThree ? daysFor({ 0: 9, 2: 1, 4: 9 }) : [], minOccurrences: 4 }).findings.length === 1)

// A failed read is never a zero and never "even"
const failed = buildSlowDayReport({ days: null })
ok('a failed read says could not check', failed.state === 'could-not-check')
ok('a failed read has no findings', failed.findings.length === 0)
ok('a failed read is not called healthy', failed.state !== 'healthy')
ok('a failed read says nothing changed', /Nothing was changed/.test(failed.detail))

// No data at all
const noDays = buildSlowDayReport({ days: [] })
ok('no days is not a failure', noDays.state === 'not-configured')
ok('no days is not called healthy', noDays.state !== 'healthy')
ok('no days has no findings', noDays.findings.length === 0)
ok('no days has no action to take', /fills in on its own/.test(noDays.action ?? ''))

const zeroBookings = buildSlowDayReport({
  days: [
    { date: '2026-11-01', booked: 0 }, { date: '2026-11-02', booked: 0 }, { date: '2026-11-03', booked: 0 },
  ],
})
ok('an empty book is not "even"', zeroBookings.state === 'not-configured')
ok('an empty book has no division by zero', Number.isFinite(zeroBookings.findings.length))
ok('an empty book says why', /nothing to compare/i.test(zeroBookings.detail), zeroBookings.detail)

// Hostile and malformed input
const malformed = buildSlowDayReport({
  days: [
    { date: 'not-a-date', booked: 5 },
    { date: '2026-11-01', booked: -3 },
    { date: '2026-11-02', booked: Number.NaN },
    { date: '2026-11-03', booked: 4 },
  ],
})
ok('malformed days are ignored, not trusted', malformed.findings.length === 0 && malformed.state === 'not-configured')
ok('a negative count never becomes a fact', !JSON.stringify(malformed).includes('-3'))

// Ranking and cap
const threeQuiet = buildSlowDayReport({
  days: [
    { date: '2026-11-01', booked: 10 }, { date: '2026-11-08', booked: 10 }, { date: '2026-11-15', booked: 10 },
    { date: '2026-11-02', booked: 1 }, { date: '2026-11-09', booked: 1 }, { date: '2026-11-16', booked: 1 },
    { date: '2026-11-03', booked: 1 }, { date: '2026-11-10', booked: 1 }, { date: '2026-11-17', booked: 1 },
    { date: '2026-11-04', booked: 2 }, { date: '2026-11-11', booked: 2 }, { date: '2026-11-18', booked: 2 },
    { date: '2026-11-05', booked: 4 }, { date: '2026-11-12', booked: 4 }, { date: '2026-11-19', booked: 4 },
  ],
})
ok('the quietest is ranked first', threeQuiet.findings[0]?.name === 'Monday', threeQuiet.findings[0]?.name)
ok('at most three are shown', threeQuiet.findings.length === 3, String(threeQuiet.findings.length))
ok('they are ordered by how quiet', threeQuiet.findings.map((f) => f.averageBooked).join(',') === '1,1,2', threeQuiet.findings.map((f) => f.averageBooked).join(','))
ok('the headline lists them in words', /Monday, Tuesday and Wednesday are your quietest days/.test(threeQuiet.headline), threeQuiet.headline)

// The audience sentence must be honest about what is known
const withAudience = buildSlowDayReport({ days: daysFor({ 0: 8, 2: 2, 4: 8 }), dormantCustomers: 42 })
ok('a known audience is offered', /42 customers who have not been back/.test(withAudience.action ?? ''), withAudience.action ?? '')
const oneCustomer = buildSlowDayReport({ days: daysFor({ 0: 8, 2: 2, 4: 8 }), dormantCustomers: 1 })
ok('one customer is not pluralised', /the 1 customer who/.test(oneCustomer.action ?? ''), oneCustomer.action ?? '')
const emptyAudience = buildSlowDayReport({ days: daysFor({ 0: 8, 2: 2, 4: 8 }), dormantCustomers: 0 })
ok('an empty audience is not promised an offer', /nobody to invite back/.test(emptyAudience.action ?? ''))
const unknownAudience = buildSlowDayReport({ days: daysFor({ 0: 8, 2: 2, 4: 8 }), dormantCustomers: null })
ok('an unknown audience is not invented', /once your customer list has people/.test(unknownAudience.action ?? ''))

// Language rules
const allReports = [quietTuesday, evenWeek, failed, noDays, zeroBookings, threeQuiet, withAudience]
const allText = allReports
  .flatMap((report) => [
    report.headline,
    report.detail,
    report.action ?? '',
    ...report.findings.map((finding) => finding.name + ' ' + finding.basis),
  ])
  .join(' ')
ok('no shaming language', !/fail|poor|bad|underperform|miss(ed)? out/i.test(allText))
ok('no revenue promise', !/will earn|guaranteed|revenue|roi|profit/i.test(allText))
ok('no technical vocabulary', !/null|undefined|NaN|percentage point|capacity|utilisation/i.test(allText))
ok('no database or API words', !/query|endpoint|record|schema|database/i.test(allText))

// Timezone bucketing: the shop's day wins over UTC's
const latePacific = new Date('2026-11-23T02:00:00Z') // 6pm Sunday 22 Nov in Los Angeles
const pacific = groupByShopDay([latePacific], 'America/Los_Angeles')
ok('a late-evening appointment stays on the shop day', pacific.length === 1 && pacific[0].date === '2026-11-22', JSON.stringify(pacific))
const utc = groupByShopDay([latePacific], 'UTC')
ok('the same instant is the next day in UTC', utc[0].date === '2026-11-23', JSON.stringify(utc))
ok('and that is a different weekday', weekdayOf(pacific[0].date) !== weekdayOf(utc[0].date))

const mixed = groupByShopDay(
  ['2026-11-22T18:00:00Z', '2026-11-22T19:00:00Z', '2026-11-23T18:00:00Z'],
  'America/Los_Angeles',
)
ok('appointments on one shop day are counted together', mixed.length === 2 && mixed[0].booked === 2, JSON.stringify(mixed))
ok('days come back in order', mixed.map((d) => d.date).join(',') === '2026-11-22,2026-11-23')
ok('invalid instants are skipped', groupByShopDay([new Date('nope'), 'also-nope'], 'UTC').length === 0)
ok('an empty list is an empty list', groupByShopDay([], 'UTC').length === 0)

// Weekday names are fixed, so a server locale cannot change them
ok('weekday names are Sunday first', WEEKDAY_NAMES[0] === 'Sunday' && WEEKDAY_NAMES[6] === 'Saturday')
ok('a known Sunday is index 0', weekdayOf('2026-11-22') === 0)
ok('a known Monday is index 1', weekdayOf('2026-11-23') === 1)
ok('weekday parsing ignores the machine zone', weekdayOf('2026-01-01') === new Date('2026-01-01T00:00:00Z').getUTCDay())

// The window rule
const fixed = new Date('2026-11-23T12:00:00Z')
const w = recentWindow(SLOW_DAY_WINDOW_WEEKS, fixed)
ok('the window ends now', w.until.getTime() === fixed.getTime())
ok('the window is eight weeks by default', w.since.getTime() === fixed.getTime() - 56 * 24 * 60 * 60 * 1000)
ok('a custom window is honoured', recentWindow(4, fixed).since.getTime() === fixed.getTime() - 28 * 24 * 60 * 60 * 1000)
ok('a nonsense window falls back rather than breaking', recentWindow(0, fixed).since.getTime() === fixed.getTime() - 56 * 24 * 60 * 60 * 1000)
ok('a negative window falls back too', recentWindow(-5, fixed).since.getTime() === fixed.getTime() - 56 * 24 * 60 * 60 * 1000)

// The card is a first-class growth card
const card = slowDayCard(quietTuesday)
ok('the card has the agreed id', card.id === 'slow-days')
ok('the card has a plain title', card.title === 'Quiet days')
ok('the card carries the state', card.state === 'needs-attention')
ok('the card carries the headline', card.headline === quietTuesday.headline)
ok('the card carries the action', card.action === quietTuesday.action)
ok('a failed read becomes a card that says so', slowDayCard(failed).state === 'could-not-check')

// Accessibility and mobile: the surface this lands on
import { readFileSync } from 'node:fs'
const page = readFileSync('src/app/(dashboard)/dashboard/growth/page.tsx', 'utf8')
ok('the quiet-days card is rendered on the growth page', /slowDayCard\(quietDays\)/.test(page))
ok('the card grid is responsive', /grid gap-4 sm:grid-cols-2/.test(page))
ok('each card is labelled by its heading', /aria-labelledby=\{'growth-' \+ card\.id\}/.test(page))
ok('the card heading is a real heading', /<h2 id=\{'growth-' \+ card\.id\}/.test(page))
ok('the state is shown as words, not a colour alone', /LABEL\[card\.state\]/.test(page))
ok('no fixed pixel width is added to the grid', !/slowDay|quiet/i.test(page) || !/w-\[\d+px\]/.test(page))
ok('the page never sends anything', /Nothing here sends a message/.test(page))

const lib = readFileSync('src/lib/growth/slow-days.ts', 'utf8')
ok('the engine takes no organisation or business id from a caller', !/businessId\s*:/.test(lib))
ok('the engine is pure: no clock read inside', !/Date\.now\(\)/.test(lib))
ok('the engine does no database access', !/prisma/i.test(lib))
ok('the shop timezone is required for bucketing', /timezone: string/.test(lib))

console.log(`\nSlow-day recommendations: ${p} passed, ${failures.length} failed`)
failures.forEach((name) => console.log('  FAIL ' + name))
process.exit(failures.length ? 1 : 0)
