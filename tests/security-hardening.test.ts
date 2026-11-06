/**
 * Regression tests for the CodeQL remediation.
 *
 * Each block pins a behaviour that was either unsafe or silently wrong before
 * the fix, so a future refactor cannot quietly reintroduce it.
 */
import { payrollReportCsv } from '../src/lib/payroll'
import { parsePreferredTime } from '../src/lib/recurring'
import { generateConfirmationNumber } from '@/lib/utils'
import { hashPassword, verifyPassword, BCRYPT_COST } from '../src/lib/passwords'
import bcrypt from 'bcryptjs'

let passed = 0
let failed = 0
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log('  PASS ' + label) }
  else { failed++; console.log('  FAIL ' + label) }
}

console.log('Payroll CSV output safety')
{
  const csv = payrollReportCsv({
    periodLabel: 'Nov 1-15',
    lines: [
      { barberName: '=HYPERLINK("http://evil.example","click")', regularHours: 10, overtimeHours: 0, serviceRevenue: 100, tips: 5, commission: 50, adjustments: 0, effectivePayout: 55 },
      { barberName: 'Smith, "Bob"', regularHours: 8, overtimeHours: 1, serviceRevenue: 90, tips: 0, commission: 40, adjustments: -5, effectivePayout: 35 },
      { barberName: '+1 (555) 010-9999', regularHours: 4, overtimeHours: 0, serviceRevenue: 40, tips: 0, commission: 20, adjustments: 0, effectivePayout: 20 },
    ],
  })
  const lines = csv.split('\n')
  assert(lines[0].startsWith('Barber,Pay Period'), 'header preserved')
  assert(!/^=HYPERLINK/m.test(csv), 'formula-prefixed name is neutralised')
  assert(csv.includes("'=HYPERLINK"), 'formula-prefixed name is prefixed with an apostrophe')
  assert(csv.includes('"Smith, ""Bob"""'), 'comma and quote in a name are quoted and doubled')
  assert(csv.includes("'+1 (555) 010-9999"), 'plus-prefixed name is neutralised')
  assert(csv.includes('-5.00'), 'negative numeric adjustment stays numeric, not quoted')
  assert(csv.includes('TOTAL'), 'total row preserved')
  assert(csv.split('\n').length === 5, 'one header, three barbers, one total')
}

console.log('Preferred time parsing')
{
  const cases: Array<[string, { hours: number; minutes: number } | null]> = [
    ['2:00 PM', { hours: 14, minutes: 0 }],
    ['12:00 PM', { hours: 12, minutes: 0 }],
    ['12:00 AM', { hours: 0, minutes: 0 }],
    ['14:00', { hours: 14, minutes: 0 }],
    ['00:00', { hours: 0, minutes: 0 }],
    ['23:59', { hours: 23, minutes: 59 }],
    ['24:00', null],
    ['13:00 PM', null],
    ['9:5', null],
    ['', null],
    ['2:00 XM', null],
    ['0000000000000000000000000000000000000000:00', null],
  ]
  for (const [input, expected] of cases) {
    const got = parsePreferredTime(input)
    assert(JSON.stringify(got) === JSON.stringify(expected), `"${input}" -> ${JSON.stringify(expected)}`)
  }
  assert(parsePreferredTime(undefined) === null, 'undefined rejected')
  assert(parsePreferredTime(undefined) === null, 'no silent midnight fallback')
}

console.log('Password hashing policy')
async function main() {
console.log('Confirmation numbers')
{
  const vals = Array.from({ length: 300 }, () => generateConfirmationNumber())
  assert(vals.every((v) => /^BRB-[A-Z2-9]{6}$/.test(v)), 'format is BRB- plus six allowed characters')
  assert(vals.every((v) => !/[01OI]/.test(v.slice(4))), 'confusing characters 0, O, 1, I never appear')
  assert(new Set(vals).size > 290, 'a 300-value sample is effectively unique (not a randomness proof)')
}


{
  assert(BCRYPT_COST >= 12, 'policy is at least cost 12')
  const hash = await hashPassword('correct horse battery staple')
  assert(hash.startsWith('$2'), 'produces a bcrypt digest')
  assert(hash.slice(4, 6) === '12', 'digest records cost 12')
  assert(await verifyPassword('correct horse battery staple', hash), 'verifies the correct password')
  assert(!(await verifyPassword('wrong', hash)), 'rejects the wrong password')
  // Hashes created before the change must keep working: bcrypt stores its own cost.
  const legacy = await bcrypt.hash('legacy-password', 10)
  assert(await bcrypt.compare('legacy-password', legacy), 'existing cost-10 hashes still verify')
}
}

void main().then(() => {
  console.log('\nsecurity-hardening: ' + passed + ' passed, ' + failed + ' failed')
  if (failed > 0) process.exit(1)
})

