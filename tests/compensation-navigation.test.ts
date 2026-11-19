import { calculatePay } from '../src/lib/pay/compensation'
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
