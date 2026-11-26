/**
 * Birthday segmentation (Section 11).
 *
 * A missing birthday is unknown and never matches; the shop's own calendar day decides
 * "today"; 29 February is a real birthday; and nothing here sends anything.
 */

import { readFileSync, existsSync } from 'node:fs'
import {
  MONTH_NAMES, birthdayInYear, daysUntilBirthday, describeBirthdayAudience, formatBirthday,
  matchesBirthdayAudience, parseBirthdayText, validateBirthday,
} from '../src/lib/marketing/birthday'
import { matchAudienceCustomer, type AudienceCustomer } from '../src/lib/marketing'

let p = 0
const f: string[] = []
const ok = (name: string, cond: boolean, extra = '') => { if (cond) p++; else f.push(name + (extra ? ' - ' + extra : '')) }

ok('a normal birthday is valid', validateBirthday(3, 4).valid)
ok('29 February is a real birthday', validateBirthday(2, 29).valid)
ok('30 February is refused', !validateBirthday(2, 30).valid)
ok('31 April is refused', !validateBirthday(4, 31).valid)
ok('month 0 is refused', !validateBirthday(0, 5).valid)
ok('month 13 is refused', !validateBirthday(13, 5).valid)
ok('day 0 is refused', !validateBirthday(5, 0).valid)
ok('day 32 is refused', !validateBirthday(5, 32).valid)
ok('the refusal is readable', /does not have 30 days/.test(validateBirthday(2, 30).errors[0] ?? ''))

ok('MM-DD parses', parseBirthdayText('03-04')?.month === 3)
ok('M/D parses', parseBirthdayText('3/4')?.day === 4)
ok('a named month parses', parseBirthdayText('March 4')?.month === 3)
ok('a named month is case insensitive', parseBirthdayText('march 4')?.day === 4)
ok('Feb 29 parses', parseBirthdayText('02-29')?.day === 29)
ok('a nonsense date is refused', parseBirthdayText('13/40') === null)
ok('a word is refused', parseBirthdayText('someday') === null)
ok('empty is refused', parseBirthdayText('') === null)
ok('null is refused', parseBirthdayText(null) === null)
ok('the label is plain English', formatBirthday({ month: 3, day: 4 }) === 'March 4')
ok('missing reads as not recorded', formatBirthday(null) === 'Not recorded')

ok('29 Feb stays 29 Feb in a leap year', birthdayInYear({ month: 2, day: 29 }, 2028).day === 29)
ok('29 Feb moves to 1 March otherwise', birthdayInYear({ month: 2, day: 29 }, 2027).month === 3)
ok('and the day is the first', birthdayInYear({ month: 2, day: 29 }, 2027).day === 1)
ok('an ordinary birthday never moves', birthdayInYear({ month: 7, day: 9 }, 2027).day === 9)

const today = { year: 2026, month: 11, day: 25 }
ok('today is zero days away', daysUntilBirthday({ month: 11, day: 25 }, today) === 0)
ok('tomorrow is one day away', daysUntilBirthday({ month: 11, day: 26 }, today) === 1)
ok('yesterday is a year away', daysUntilBirthday({ month: 11, day: 24 }, today) > 300)
ok('New Year crosses the year boundary', daysUntilBirthday({ month: 1, day: 1 }, { year: 2026, month: 12, day: 31 }) === 1)
ok('29 Feb is marked on 1 March in 2027', daysUntilBirthday({ month: 2, day: 29 }, { year: 2027, month: 3, day: 1 }) === 0)

ok('today matches today only', matchesBirthdayAudience('BIRTHDAY_TODAY', { month: 11, day: 25 }, today))
ok('today does not match tomorrow', !matchesBirthdayAudience('BIRTHDAY_TODAY', { month: 11, day: 26 }, today))
ok('the week includes six days out', matchesBirthdayAudience('BIRTHDAY_WEEK', { month: 12, day: 1 }, today))
ok('the week excludes seven days out', !matchesBirthdayAudience('BIRTHDAY_WEEK', { month: 12, day: 2 }, today))
ok('the month includes a later day', matchesBirthdayAudience('BIRTHDAY_MONTH', { month: 11, day: 1 }, today))
ok('the month excludes another month', !matchesBirthdayAudience('BIRTHDAY_MONTH', { month: 12, day: 1 }, today))
ok('a missing birthday never matches', !matchesBirthdayAudience('BIRTHDAY_MONTH', null, today))
ok('the reason is a sentence', /seven days/.test(describeBirthdayAudience('BIRTHDAY_WEEK')))
ok('every month has a name', MONTH_NAMES.length === 12)

// --- through the campaign matcher, in the shop's zone ---
const customer = (birthdayMonth: number | null, birthdayDay: number | null): AudienceCustomer => ({
  id: 'c1', firstName: 'Ada', lastName: 'L', phone: '555', email: 'ada@example.invalid',
  birthdayMonth, birthdayDay, appointments: [],
})
const latePacific = new Date('2026-12-01T07:00:00Z') // 30 November, 11pm in Los Angeles
const nov = matchAudienceCustomer(customer(11, 15), 'BIRTHDAY_MONTH', latePacific, { timezone: 'America/Los_Angeles' })
const dec = matchAudienceCustomer(customer(12, 2), 'BIRTHDAY_MONTH', latePacific, { timezone: 'America/Los_Angeles' })
ok('the shop month is November at 11pm Pacific', nov.matches)
ok('December is not November in the shop zone', !dec.matches)
ok('the same instant is December in UTC', matchAudienceCustomer(customer(12, 2), 'BIRTHDAY_MONTH', latePacific, { timezone: 'UTC' }).matches)
ok('no birthday is no match', !matchAudienceCustomer(customer(null, null), 'BIRTHDAY_MONTH', latePacific, { timezone: 'America/Los_Angeles' }).matches)
ok('half a birthday is no match', !matchAudienceCustomer(customer(11, null), 'BIRTHDAY_TODAY', latePacific, {}).matches)
ok('the match explains itself', /Birthday is this month/.test(nov.reason))

// --- the source stays honest ---
const marketing = readFileSync('src/lib/marketing.ts', 'utf8')
ok('the dead comment is gone', !marketing.includes('not currently in the schema'))
ok('all three audiences are handled', ['BIRTHDAY_TODAY', 'BIRTHDAY_WEEK', 'BIRTHDAY_MONTH'].every((a) => marketing.includes(a)))
ok('the consent filter is untouched', marketing.includes('customer.emailOptOut === false || customer.smsConsent'))
ok('nothing here sends a message', !/sendEmail|sendSms|twilio/i.test(readFileSync('src/lib/marketing/birthday.ts', 'utf8')))
const schema = readFileSync('prisma/schema.prisma', 'utf8')
ok('the schema stores month and day only', schema.includes('birthdayMonth') && schema.includes('birthdayDay'))
ok('no date of birth is stored', !/dateOfBirth|birthDate/.test(schema))
const migration = 'prisma/migrations/20261126090000_customer_birthday/migration.sql'
ok('the migration exists', existsSync(migration))
const sql = existsSync(migration) ? readFileSync(migration, 'utf8') : ''
ok('the migration only adds', !/DROP|DELETE|TRUNCATE/i.test(sql))
ok('both columns are nullable', !/NOT NULL/i.test(sql))
ok('the month is indexed per business', sql.includes('Customer_businessId_birthdayMonth_idx'))

console.log('\nBirthday segmentation: ' + p + ' passed, ' + f.length + ' failed')
if (f.length) { f.forEach((n) => console.log('  FAIL ' + n)); process.exit(1) }
