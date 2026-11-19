import { buildUtilisation, weeklyOpenMinutes } from '../src/lib/analytics/utilisation'

let p = 0
const f: string[] = []
const ok = (n: string, c: boolean, d = '') => { if (c) p++; else f.push(n + (d ? ' — ' + d : '')) }

const sched = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isOff: false },
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isOff: false },
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isOff: false },
  { dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isOff: false },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isOff: false },
  { dayOfWeek: 6, startTime: '09:00', endTime: '17:00', isOff: true },
  { dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isOff: true },
]

// Schedule arithmetic
ok('weekly open minutes', weeklyOpenMinutes(sched) === 5 * 540)
ok('a day off is not counted', weeklyOpenMinutes(sched) === 2700)
ok('bad clock returns null', weeklyOpenMinutes([{ dayOfWeek: 1, startTime: '9am', endTime: '18:00', isOff: false }]) === null)
ok('end before start returns null', weeklyOpenMinutes([{ dayOfWeek: 1, startTime: '18:00', endTime: '09:00', isOff: false }]) === null)

const appt = (status: string, mins: number | null) => ({ startTime: new Date('2026-11-10T10:00:00Z'), durationMinutes: mins, status })

// Utilisation
const full = buildUtilisation({
  schedules: sched,
  appointments: [appt('COMPLETED', 60), appt('CONFIRMED', 30), appt('CANCELLED', 45), appt('NO_SHOW', 60)],
  memberships: [{ status: 'ACTIVE', planPrice: 40 }, { status: 'ACTIVE', planPrice: 25.5 }, { status: 'CANCELED', planPrice: 40 }],
  rangeDays: 7,
})
ok('booked minutes exclude cancellations and no-shows', full.utilisation.bookedMinutes === 90)
ok('available minutes for a week', full.utilisation.availableMinutes === 2700)
ok('percent is a share of open hours', full.utilisation.percent === 3)
ok('active members counted', full.membership.activeCount === 2)
ok('canceled member is not revenue', full.membership.monthlyRevenue === 65.5)
ok('everything read', full.allRead)

// Never invent a number
const noSched = buildUtilisation({ schedules: null, appointments: [appt('COMPLETED', 60)], memberships: null, rangeDays: 7 })
ok('no schedule means no percent', noSched.utilisation.percent === null)
ok('no schedule is not 0%', noSched.utilisation.percent !== 0)
ok('no schedule says could not check', noSched.utilisation.note === 'Could not be checked.')
ok('no memberships means no count', noSched.membership.activeCount === null)
ok('not all read', !noSched.allRead)

const noAppts = buildUtilisation({ schedules: sched, appointments: null, memberships: [], rangeDays: 7 })
ok('failed appointment read is null', noAppts.utilisation.bookedMinutes === null)
ok('failed read is not zero', noAppts.utilisation.bookedMinutes !== 0)
ok('percent withheld', noAppts.utilisation.percent === null)

const emptyShop = buildUtilisation({ schedules: sched, appointments: [], memberships: [], rangeDays: 7 })
ok('a real zero is zero', emptyShop.utilisation.bookedMinutes === 0)
ok('a real zero percent is shown', emptyShop.utilisation.percent === 0)
ok('no members is a real zero', emptyShop.membership.activeCount === 0 && emptyShop.membership.monthlyRevenue === 0)

// Closed shop and unreadable prices
const closed = buildUtilisation({ schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isOff: true }], appointments: [], memberships: [], rangeDays: 7 })
ok('closed week has no percentage', closed.utilisation.percent === null)
ok('closed week explains itself', /nothing to measure/.test(closed.utilisation.note))

const badPrice = buildUtilisation({ schedules: sched, appointments: [], memberships: [{ status: 'ACTIVE', planPrice: null }], rangeDays: 7 })
ok('unreadable price withholds the total', badPrice.membership.monthlyRevenue === null)
ok('but still counts the member', badPrice.membership.activeCount === 1)
ok('and says why', /plan price could not be read/.test(badPrice.membership.note))

// Range scaling and caps
const month = buildUtilisation({ schedules: sched, appointments: [], memberships: [], rangeDays: 28 })
ok('available minutes scale with the range', month.utilisation.availableMinutes === 2700 * 4)
const overbooked = buildUtilisation({ schedules: sched, appointments: Array.from({ length: 60 }, () => appt('COMPLETED', 60)), memberships: [], rangeDays: 7 })
ok('percent never exceeds 100', overbooked.utilisation.percent === 100)
const zeroRange = buildUtilisation({ schedules: sched, appointments: [], memberships: [], rangeDays: 0 })
ok('a zero-day range is treated as one day', zeroRange.utilisation.availableMinutes === Math.round(2700 / 7))

if (f.length) { console.error('FAILURES:'); for (const x of f) console.error('  ' + x) }
console.log(`\nUtilisation: ${p} passed, ${f.length} failed`)
process.exit(f.length ? 1 : 0)
