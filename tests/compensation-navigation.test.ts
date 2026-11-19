import { calculatePay, resolvePayout, explainStoredLine } from '../src/lib/pay/compensation'
import { deriveNav, validateNav, resolveNav, isSafeHref, MAX_NAV_ITEMS } from '../src/lib/website/navigation'

let p = 0
const f: string[] = []
const ok = (n: string, c: boolean, d = '') => { if (c) p++; else f.push(n + (d ? ' — ' + d : '')) }

// ─── Commission: must not move by a cent ───────────────────────────────────
const commission = calculatePay({
  model: 'COMMISSION', serviceRevenue: 1000, commissionRate: 40, hoursWorked: null, hourlyRate: null,
  boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY',
})
ok('commission is unchanged', commission.amount === 400)
ok('commission is known', commission.known)
ok('a null model behaves as commission', calculatePay({ ...{ serviceRevenue: 1000, commissionRate: 40, hoursWorked: null, hourlyRate: null, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' }, model: null }).amount === 400)
ok('commission rounds to cents', calculatePay({ model: 'COMMISSION', serviceRevenue: 33.33, commissionRate: 33, hoursWorked: null, hourlyRate: null, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' }).amount === 11)
ok('no rate means unknown', calculatePay({ model: 'COMMISSION', serviceRevenue: 1000, commissionRate: null, hoursWorked: null, hourlyRate: null, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' }).known === false)
ok('no revenue means unknown, not zero', calculatePay({ model: 'COMMISSION', serviceRevenue: null, commissionRate: 40, hoursWorked: null, hourlyRate: null, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' }).amount === null)

// ─── Hourly ────────────────────────────────────────────────────────────────
const hourly = calculatePay({ model: 'HOURLY', serviceRevenue: 500, commissionRate: 40, hoursWorked: 32.5, hourlyRate: 22, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' })
ok('hourly pays for hours, not sales', hourly.amount === 715)
ok('unrecorded hours are unknown', calculatePay({ model: 'HOURLY', serviceRevenue: 0, commissionRate: 40, hoursWorked: null, hourlyRate: 22, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' }).known === false)
ok('a missing rate is unknown', calculatePay({ model: 'HOURLY', serviceRevenue: 0, commissionRate: 40, hoursWorked: 10, hourlyRate: null, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' }).known === false)

// ─── Booth rental ──────────────────────────────────────────────────────────
const booth = calculatePay({ model: 'BOOTH_RENTAL', serviceRevenue: 1200, commissionRate: null, hoursWorked: null, hourlyRate: null, boothRentAmount: 300, boothRentPeriod: 'WEEKLY', payPeriod: 'WEEKLY' })
ok('booth rental is revenue minus rent', booth.amount === 900)
ok('booth rental owes nothing', booth.owed === null)
const short = calculatePay({ model: 'BOOTH_RENTAL', serviceRevenue: 200, commissionRate: null, hoursWorked: null, hourlyRate: null, boothRentAmount: 300, boothRentPeriod: 'WEEKLY', payPeriod: 'WEEKLY' })
ok('a shortfall is reported as owed, not floored silently', short.owed === 100)
ok('a shortfall pays zero rather than negative money', short.amount === 0)
ok('a shortfall explains itself', /did not cover/.test(short.explanation))
const mismatch = calculatePay({ model: 'BOOTH_RENTAL', serviceRevenue: 1200, commissionRate: null, hoursWorked: null, hourlyRate: null, boothRentAmount: 1200, boothRentPeriod: 'MONTHLY', payPeriod: 'WEEKLY' })
ok('monthly rent in a weekly period is refused, not prorated by guess', mismatch.known === false)
ok('and says why', /prorating/.test(mismatch.explanation))
ok('a null rent period defaults to weekly', calculatePay({ model: 'BOOTH_RENTAL', serviceRevenue: 500, commissionRate: null, hoursWorked: null, hourlyRate: null, boothRentAmount: 200, boothRentPeriod: null, payPeriod: 'WEEKLY' }).amount === 300)

// ─── Hybrid ────────────────────────────────────────────────────────────────
const hybridHours = calculatePay({ model: 'HYBRID', serviceRevenue: 1000, commissionRate: 20, hoursWorked: 20, hourlyRate: 15, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' })
ok('hybrid adds base and commission', hybridHours.amount === 500)
const hybridThreshold = calculatePay({ model: 'HYBRID', serviceRevenue: 1000, commissionRate: 20, hoursWorked: 20, hourlyRate: 15, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY', commissionThreshold: 600 })
ok('a threshold limits commission to the excess', hybridThreshold.amount === 380)
const hybridRent = calculatePay({ model: 'HYBRID', serviceRevenue: 1000, commissionRate: 10, hoursWorked: null, hourlyRate: null, boothRentAmount: 200, boothRentPeriod: 'WEEKLY', payPeriod: 'WEEKLY' })
ok('hybrid can use rent as its base', hybridRent.amount === 300)
ok('hybrid with nothing to base on is unknown', calculatePay({ model: 'HYBRID', serviceRevenue: 1000, commissionRate: 10, hoursWorked: 5, hourlyRate: null, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' }).known === false)

// ─── Unknown model ─────────────────────────────────────────────────────────
const weird = calculatePay({ model: 'PROFIT_SHARE', serviceRevenue: 1000, commissionRate: 10, hoursWorked: 1, hourlyRate: 1, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' })
ok('an unrecognised model is unknown, never commission by accident', weird.known === false)

// ─── Payroll wiring: the ledger's commission is never recalculated ─────────
const base = { hoursWorked: null, hourlyRate: null, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' as string | null }

// The default model must reproduce the old arithmetic to the cent.
const legacy = resolvePayout({ ...base, model: 'COMMISSION', serviceRevenue: 1000, commissionRate: 40, commissionAmount: 400, adjustments: 12.5, tipsOwned: 30 })
ok('commission payout equals ledger + adjustments + tips', legacy.amount === 442.5)
ok('commission payout is known', legacy.known)
ok('the ledger figure wins over rate x revenue', resolvePayout({ ...base, model: 'COMMISSION', serviceRevenue: 1000, commissionRate: 40, commissionAmount: 250 }).amount === 250)

// Hourly: hours x rate, then the same tail.
const hourlyPay = resolvePayout({ ...base, model: 'HOURLY', serviceRevenue: 900, commissionRate: null, commissionAmount: 360, hoursWorked: 30, hourlyRate: 20, adjustments: 0, tipsOwned: 15 })
ok('hourly payout is hours x rate plus tips', hourlyPay.amount === 615)
ok('hourly payout is known', hourlyPay.known)

// Booth rental: revenue minus rent, plus the tail, with a shortfall reported.
const boothPay = resolvePayout({ ...base, model: 'BOOTH_RENTAL', serviceRevenue: 1000, commissionRate: null, commissionAmount: 400, boothRentAmount: 250, boothRentPeriod: 'WEEKLY', tipsOwned: 10 })
ok('booth payout is revenue minus rent plus tips', boothPay.amount === 760)
ok('booth payout owes nothing here', boothPay.owed === null)

// Hybrid: base plus the ledger's commission, not a second commission.
const hybridPay = resolvePayout({ ...base, model: 'HYBRID', serviceRevenue: 1000, commissionRate: 20, commissionAmount: 200, hoursWorked: 20, hourlyRate: 15 })
ok('hybrid payout uses the ledger commission once', hybridPay.amount === 500)

// Unknown inputs fall back to real money and say so, never to zero.
const missingHours = resolvePayout({ ...base, model: 'HOURLY', serviceRevenue: 900, commissionRate: null, commissionAmount: 360, hoursWorked: null, hourlyRate: 20, adjustments: 5, tipsOwned: 10 })
ok('unrecorded hours fall back to the commission figure', missingHours.amount === 375)
ok('the fallback is not claimed as a calculation', missingHours.known === false)
ok('the fallback explains itself in plain words', /Showing the commission figure/.test(missingHours.note ?? ''))
ok('the fallback is never zero when money was earned', missingHours.amount !== 0)
const mismatchPay = resolvePayout({ ...base, model: 'BOOTH_RENTAL', serviceRevenue: 1000, commissionRate: null, commissionAmount: 400, boothRentAmount: 1000, boothRentPeriod: 'MONTHLY' })
ok('a rent period mismatch falls back rather than prorating', mismatchPay.known === false && mismatchPay.amount === 400)

// A barber with no model set at all behaves exactly like before.
ok('no model means commission', resolvePayout({ ...base, model: null, serviceRevenue: 100, commissionRate: 50, commissionAmount: 50 }).amount === 50)

// ─── The note beside a stored figure, derived on read ──────────────────────
const lineBase = { serviceRevenue: 1000, commission: 400, regularHours: 0, overtimeHours: 0, hourlyRate: null, boothRentAmount: null, boothRentPeriod: null, payPeriod: 'WEEKLY' as string | null }
const commissionLine = explainStoredLine({ ...lineBase, model: 'COMMISSION' })
ok('a commission line explains itself', commissionLine.payoutKnown && /ledger/.test(commissionLine.payoutNote))
const hourlyLine = explainStoredLine({ ...lineBase, model: 'HOURLY', regularHours: 20, overtimeHours: 5, hourlyRate: 18 })
ok('an hourly line says it was paid for hours', hourlyLine.payoutKnown && /hours/.test(hourlyLine.payoutNote))
const gapLine = explainStoredLine({ ...lineBase, model: 'HOURLY', hourlyRate: 18 })
ok('a stored line with no hours is flagged for checking', gapLine.payoutKnown === false)
ok('and it says the figure is the commission recorded', /commission recorded/.test(gapLine.payoutNote))
ok('the note never claims a calculation it did not do', !/hours at the hourly rate/.test(gapLine.payoutNote))
const rentLine = explainStoredLine({ ...lineBase, model: 'BOOTH_RENTAL', boothRentAmount: 250, boothRentPeriod: 'WEEKLY' })
ok('a booth line explains the rent', rentLine.payoutKnown && /rent/i.test(rentLine.payoutNote))
ok('an unknown model is flagged, not silently explained', explainStoredLine({ ...lineBase, model: 'MYSTERY' }).payoutKnown === false)

// ─── Navigation ────────────────────────────────────────────────────────────
const sections = [
  { key: 'services', label: 'Services', href: '/services', enabled: true },
  { key: 'team', label: 'Team', href: '/team', enabled: true },
  { key: 'shop', label: 'Shop', href: '/shop', enabled: false },
]
ok('derived menu follows enabled sections', deriveNav(sections).map((i) => i.label).join(',') === 'Services,Team')
ok('null storage means derived', resolveNav(null, sections).source === 'derived')
ok('undefined storage means derived', resolveNav(undefined, sections).source === 'derived')
const custom = resolveNav([{ label: 'Prices', href: '/services', visible: true }, { label: 'Barbers', href: '/team', visible: true }], sections)
ok('a saved menu is used', custom.source === 'custom' && custom.items[0].label === 'Prices')
ok('a saved menu renames without touching sections', custom.items[0].href === '/services')
const hidden = resolveNav([{ label: 'Prices', href: '/services', visible: true }, { label: 'Team', href: '/team', visible: false }], sections)
ok('hidden items are dropped from the menu', hidden.items.length === 1)
ok('all-hidden falls back to derived', resolveNav([{ label: 'Prices', href: '/services', visible: false }], sections).source === 'derived')
ok('all-hidden explains itself', /Every menu item is hidden/.test(resolveNav([{ label: 'Prices', href: '/services', visible: false }], sections).note ?? ''))
const hostile = resolveNav([{ label: 'Click', href: 'https://evil.example' }], sections)
ok('an off-site link falls back to derived', hostile.source === 'derived')
ok('an off-site link is reported, not silently dropped', (hostile.note ?? '').length > 0)
ok('javascript: is unsafe', !isSafeHref('javascript:alert(1)'))
ok('a protocol-relative link is unsafe', !isSafeHref('//evil.example/x'))
ok('a same-site path is safe', isSafeHref('/services'))
ok('a backslash trick is unsafe', !isSafeHref('/\\evil.example'))
ok('a too-long label is rejected', validateNav([{ label: 'x'.repeat(30), href: '/services' }]).ok === false)
ok('an empty label is rejected', validateNav([{ label: '  ', href: '/services' }]).ok === false)
ok('more than the maximum is rejected', validateNav(Array.from({ length: MAX_NAV_ITEMS + 1 }, () => ({ label: 'A', href: '/a' }))).ok === false)
ok('exactly the maximum is accepted', validateNav(Array.from({ length: MAX_NAV_ITEMS }, (_, i) => ({ label: 'A' + i, href: '/a' + i }))).ok)
ok('a non-list is rejected', validateNav({ label: 'x' }).ok === false)
ok('a junk entry is rejected without killing the rest', validateNav([null, { label: 'Prices', href: '/services' }]).items.length === 1)

if (f.length) { console.error('FAILURES:'); for (const x of f) console.error('  ' + x) }
console.log(`\nCompensation and navigation: ${p} passed, ${f.length} failed`)
process.exit(f.length ? 1 : 0)
