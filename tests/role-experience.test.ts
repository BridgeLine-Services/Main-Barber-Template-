/**
 * Part 7.1: each role is told what its page is for, and what it cannot do.
 *
 * Two failure modes matter here, and the suite tests both. The first is a link to a page
 * that does not exist, which is the dead button the directive forbids. The second is
 * telling a barber they can do something only an owner can do, which turns a permission
 * boundary into a support call.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describeRoleExperience, roleGreeting } from '../src/lib/role-experience'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    return
  }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')
const ROLES = ['OWNER', 'BUSINESS_ADMIN', 'BARBER', 'CUSTOMER', 'PLATFORM_OWNER', 'PUBLIC_VISITOR', 'LOCATION_MANAGER'] as const

/** Does a page file exist for this href? Route groups like (dashboard) are transparent. */
function pageExists(href: string): boolean {
  const segments = href.split('/').filter(Boolean)
  const appDir = join(ROOT, 'src', 'app')
  const candidates: string[] = []

  function walk(dir: string, remaining: string[], depth: number) {
    if (remaining.length === 0) {
      if (existsSync(join(dir, 'page.tsx'))) candidates.push(dir)
      return
    }
    if (depth > 6) return
    const [head, ...rest] = remaining
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (!statSync(full).isDirectory()) continue
      if (entry === head) walk(full, rest, depth + 1)
      else if (entry.startsWith('(')) walk(full, remaining, depth + 1)
    }
  }

  walk(appDir, segments, 0)
  return candidates.length > 0
}

// ─── Every role is described ───────────────────────────────────────────────

for (const role of ROLES) {
  const experience = describeRoleExperience(role)
  ok(`${role}: has a human label, not a database value`, experience.label !== role && experience.label.length > 3, experience.label)
  ok(`${role}: explains itself in one sentence`, experience.intro.length > 30)
  ok(`${role}: says something to look at first`, experience.focus.length > 0)
  ok(`${role}: every focus item explains why`, experience.focus.every((f) => f.why.length > 10))
  ok(`${role}: every focus link is a real page`, experience.focus.every((f) => pageExists(f.href)), experience.focus.filter((f) => !pageExists(f.href)).map((f) => f.href).join(','))
  ok(`${role}: no link is a placeholder`, experience.focus.every((f) => !/#|example|todo/i.test(f.href)))
}

// ─── Boundaries match the permission model ─────────────────────────────────

const barber = describeRoleExperience('BARBER')
ok('a barber is told they see their own clients only', barber.boundaries.some((b) => /own appointments|other barbers/i.test(b)), barber.boundaries.join(' | '))
ok('a barber is not offered payroll', !barber.focus.some((f) => f.href.includes('/payroll')))
ok('a barber is not offered shop settings', !barber.focus.some((f) => f.href.includes('/settings')))
ok('a barber is offered their own commission page', barber.focus.some((f) => f.href === '/dashboard/my-commissions'))
ok('a barber is offered their own time clock', barber.focus.some((f) => f.href === '/dashboard/my-time-clock'))
ok('a barber is told some decisions are the owner’s', barber.needsOwnerApproval === true)

const coOwner = describeRoleExperience('BUSINESS_ADMIN')
ok('a co-owner is told payments belong to the owner', coOwner.boundaries.some((b) => /payment/i.test(b)), coOwner.boundaries.join(' | '))
ok('a co-owner is told owner-level access is not theirs to change', coOwner.boundaries.some((b) => /owner-level access|owner-level/i.test(b)))
ok('a co-owner is not offered the payroll page', !coOwner.focus.some((f) => f.href.includes('/payroll')))
ok('a co-owner gets operational calendar and service links',
  coOwner.focus.some((f) => f.href === '/dashboard/calendar') && coOwner.focus.some((f) => f.href === '/dashboard/services'))
ok('a co-owner is told payroll and exports remain restricted',
  coOwner.boundaries.some((b) => /Payroll totals, customer exports/i.test(b)))

const customer = describeRoleExperience('CUSTOMER')
ok('a customer is offered booking', customer.focus.some((f) => f.href === '/book'))
ok('a customer is not offered any dashboard page', !customer.focus.some((f) => f.href.startsWith('/dashboard')))
ok('a customer is told they see only their own appointments', customer.boundaries.some((b) => /only see your own/i.test(b)))

const owner = describeRoleExperience('OWNER')
ok('an owner has no boundary list to apologise for', owner.boundaries.length === 0)
ok('an owner is pointed at today first', owner.focus[0].href === '/dashboard')

// ─── Unknown input fails closed ────────────────────────────────────────────

for (const bad of [null, undefined, '', 'SUPERUSER', 'owner', 'ADMIN']) {
  const experience = describeRoleExperience(bad as string | null | undefined)
  ok(`an unknown role (${String(bad)}) gets the visitor view`, experience.role === 'PUBLIC_VISITOR', experience.role)
  ok(`an unknown role (${String(bad)}) is offered nothing private`, !experience.focus.some((f) => f.href.startsWith('/dashboard')))
}
ok('the greeting names the role in words', roleGreeting('BARBER').startsWith('Barber:'))
ok('the greeting is never a bare database value', !roleGreeting('BUSINESS_ADMIN').startsWith('BUSINESS_ADMIN'))

// ─── The card renders only what it is given ────────────────────────────────

const card = readFileSync(join(ROOT, 'src/components/dashboard/RoleWelcomeCard.tsx'), 'utf8')
ok('the card takes the role as a prop rather than reading a session itself', /role: string \| null \| undefined/.test(card))
ok('the card links through next/link', /from 'next\/link'/.test(card))
ok('the card does not fetch or mutate anything', !/fetch\(|useEffect|prisma/i.test(card))
ok('the card hides an empty boundary list instead of showing a blank heading', /boundaries\.length > 0/.test(card))

const page = readFileSync(join(ROOT, 'src/app/(dashboard)/dashboard/page.tsx'), 'utf8')
ok('the dashboard renders the card with the resolved dashboard experience role', /RoleWelcomeCard role=\{dashboardExperienceRole\}/.test(page))
ok('the existing today view is still rendered', /TodayAppointmentsView/.test(page))
ok('the barber filter on the today view is untouched', /userRole === 'BARBER' && barberId/.test(page))

// ─── Organization roles ────────────────────────────────────────────────────
// These roles exist in the permission model. Before this block they had no role
// experience at all, so a regional manager was described as a public visitor.

for (const role of ['ORGANIZATION_OWNER', 'CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'FRANCHISE_OWNER', 'LOCATION_MANAGER'] as const) {
  const org = describeRoleExperience(role)
  ok(`${role}: is not described as a visitor`, org.role !== 'PUBLIC_VISITOR', org.label)
  ok(`${role}: has a human label`, org.label !== role && org.label.length > 3, org.label)
  ok(`${role}: every focus link is a real page`, org.focus.every((f) => pageExists(f.href)), org.focus.filter((f) => !pageExists(f.href)).map((f) => f.href).join(','))
  ok(`${role}: explains why each link matters`, org.focus.every((f) => f.why.length > 10))
}

const regional = describeRoleExperience('REGIONAL_MANAGER')
ok('a regional manager is told the region limit plainly', regional.boundaries.some((b) => /regions assigned to you/i.test(b)), regional.boundaries.join(' | '))
ok('a regional manager is not offered the organization brand', !regional.focus.some((f) => /brand|settings/i.test(f.href)))
ok('a regional manager does not see shop takings', !regional.focus.some((f) => /analytics|payroll/i.test(f.href)))

const franchise = describeRoleExperience('FRANCHISE_OWNER')
ok('a franchise owner is told other locations are not theirs', franchise.boundaries.some((b) => /belong to their own owners/i.test(b)), franchise.boundaries.join(' | '))

const locationManager = describeRoleExperience('LOCATION_MANAGER')
ok('a location manager is explicitly described', locationManager.label === 'Location manager')
ok('a location manager is shown assigned locations and announcements',
  locationManager.focus.some((f) => f.href === '/dashboard/organization')
    && locationManager.focus.some((f) => f.href === '/dashboard/organization/announcements'))
ok('a location manager is told their assignment boundary',
  locationManager.boundaries.some((b) => /outside your assignments or regions/i.test(b)))
ok('a location manager does not get corporate service or branding links',
  !locationManager.focus.some((f) => /organization\/(services|branding)/.test(f.href)))

const sidebar = readFileSync(join(ROOT, 'src/components/dashboard/Sidebar.tsx'), 'utf8')
ok('co-owner navigation filters owner-only destinations',
  /coOwnerOnlyHiddenHrefs/.test(sidebar) && /userRole === 'BUSINESS_ADMIN'/.test(sidebar))
const appointmentList = readFileSync(join(ROOT, 'src/components/dashboard/AppointmentsListView.tsx'), 'utf8')
ok('appointment exports remain owner-only and location managers are read-only',
  /isOwner && \(/.test(appointmentList) && /!isLocationManager && \(/.test(appointmentList))
ok('location manager appointment list is scoped in the server page',
  /locationBusinessIds\.includes\(organizationContext\.homeBusinessId\)/.test(readFileSync(join(ROOT, 'src/app/(dashboard)/dashboard/appointments/page.tsx'), 'utf8')))
ok('organization navigation is selected by the resolved organization role',
  /organizationNavigation\[organizationRole/.test(sidebar) && /resolveOrganizationContext/.test(readFileSync(join(ROOT, 'src/app/(dashboard)/dashboard/layout.tsx'), 'utf8')))
const mobileNav = readFileSync(join(ROOT, 'src/components/dashboard/MobileBottomNav.tsx'), 'utf8')
ok('mobile navigation uses role-specific destinations',
  /managerItems/.test(mobileNav) && /userRole === 'OWNER' \|\| userRole === 'BUSINESS_ADMIN'/.test(mobileNav))
const todayView = readFileSync(join(ROOT, 'src/components/dashboard/TodayAppointmentsView.tsx'), 'utf8')
ok('today appointments show a retry state instead of false zero totals',
  /!loadError && \(/.test(todayView) && /Appointments are unavailable/.test(todayView) && /onClick=\{refreshData\}/.test(todayView))
ok('location manager home data is tied to an assigned home location',
  /locationBusinessIds\.includes\(organizationContext\.homeBusinessId\)/.test(page) && /withTenant\(dashboardBusinessId/.test(page))
const appointmentApi = readFileSync(join(ROOT, 'src/app/api/dashboard/appointments/route.ts'), 'utf8')
ok('appointment refresh resolves the manager home location before querying',
  /resolveOrganizationContext\(user\.id\)/.test(appointmentApi) && /locationBusinessIds\.includes/.test(appointmentApi))
ok('an unknown role still falls back to the visitor experience', describeRoleExperience('SOMETHING_ELSE').role === 'PUBLIC_VISITOR')

console.log(`\nRole experience: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

