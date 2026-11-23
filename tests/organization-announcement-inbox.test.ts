/**
 * Organization announcement delivery (Priority 3, part E): the rules, pinned.
 *
 * The audience resolver was already tested. This file tests the part that turns a resolved
 * audience into an inbox: who can see a stored announcement, who can mark it read, what a
 * sender can actually reach, and what a person is told when there is nothing to show.
 *
 * Every case is built from a scope the server would have resolved. None of these functions
 * accepts an organization id or a recipient id, which is the property most of these
 * assertions are protecting.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  announcementReaches,
  audienceLabel,
  buildInbox,
  emptyStateMessage,
  markReadVerdict,
  planDelivery,
  sentOnWords,
  unreadCount,
  type AnnouncementRecord,
  type ViewerScope,
} from '../src/lib/organization/announcement-inbox'
import type { LocationRef } from '../src/lib/organization/announcements'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ORG = 'org-1'

/** Two open shops in the West, one open shop in the East, one closed shop in the West. */
const LOCATIONS: LocationRef[] = [
  { businessId: 'b-downtown', region: 'West', status: 'active' },
  { businessId: 'b-airport', region: 'West', status: 'active' },
  { businessId: 'b-harbor', region: 'East', status: 'active' },
  { businessId: 'b-closed', region: 'West', status: 'closed' },
]

const OWNER: ViewerScope = {
  userId: 'u-owner',
  organizationId: ORG,
  role: 'ORGANIZATION_OWNER',
  businessIds: ['b-downtown', 'b-airport', 'b-harbor'],
}
const WEST_MANAGER: ViewerScope = {
  userId: 'u-west',
  organizationId: ORG,
  role: 'REGIONAL_MANAGER',
  businessIds: ['b-downtown', 'b-airport'],
}
const EAST_MANAGER: ViewerScope = {
  userId: 'u-east',
  organizationId: ORG,
  role: 'REGIONAL_MANAGER',
  businessIds: ['b-harbor'],
}
const DOWNTOWN_BARBER: ViewerScope = {
  userId: 'u-barber',
  organizationId: ORG,
  role: 'BARBER',
  businessIds: ['b-downtown'],
}
const CUSTOMER: ViewerScope = { userId: 'u-customer', organizationId: ORG, role: 'CUSTOMER', businessIds: [] }

function record(overrides: Partial<AnnouncementRecord> = {}): AnnouncementRecord {
  return {
    id: 'a-1',
    organizationId: ORG,
    title: 'New opening hours',
    body: 'The Downtown shop opens at 9 from Monday.',
    audienceType: 'region',
    audienceValues: ['West'],
    resolvedBusinessIds: ['b-downtown', 'b-airport'],
    authorId: 'u-owner',
    authorName: 'Sam Owner',
    publishedAt: '2026-11-23T18:00:00.000Z',
    createdAt: '2026-11-23T17:59:00.000Z',
    ...overrides,
  }
}

// ─── Audience restrictions ─────────────────────────────────────────────────

const west = record()
ok('a manager in the region sees the announcement', announcementReaches(west, WEST_MANAGER).visible === true)
ok('the owner sees it at their own locations', announcementReaches(west, OWNER).visible === true)
ok('a barber at an addressed shop sees it', announcementReaches(west, DOWNTOWN_BARBER).visible === true)

const eastReach = announcementReaches(west, EAST_MANAGER)
ok('a manager in another region does not see it', eastReach.visible === false)
ok('the refusal says it was addressed elsewhere', /other locations/i.test(eastReach.reason))

const eastOnly = record({ id: 'a-east', audienceType: 'region', audienceValues: ['East'], resolvedBusinessIds: ['b-harbor'] })
ok('an East-only announcement is invisible to the West manager', announcementReaches(eastOnly, WEST_MANAGER).visible === false)
ok('an East-only announcement is visible to the East manager', announcementReaches(eastOnly, EAST_MANAGER).visible === true)

const namedGroup = record({
  id: 'a-group',
  audienceType: 'group',
  audienceValues: ['b-airport'],
  resolvedBusinessIds: ['b-airport'],
})
ok('a named-group announcement reaches only the group location', announcementReaches(namedGroup, WEST_MANAGER).visible === true)
ok('a named-group announcement skips a shop outside the group', announcementReaches(namedGroup, DOWNTOWN_BARBER).visible === false)

const everyone = record({ id: 'a-all', audienceType: 'all', audienceValues: [], resolvedBusinessIds: ['b-downtown', 'b-airport', 'b-harbor'] })
ok('everyone means every open location', announcementReaches(everyone, EAST_MANAGER).visible === true)

ok('a customer role sees no announcement', announcementReaches(west, CUSTOMER).visible === false)
ok('an unsent announcement is invisible', announcementReaches(record({ publishedAt: null }), OWNER).visible === false)
ok(
  'an announcement with no delivered location is invisible',
  announcementReaches(record({ resolvedBusinessIds: [] }), OWNER).visible === false,
)
ok('a missing resolved set does not mean everyone', announcementReaches(record({ resolvedBusinessIds: undefined as unknown as string[] }), OWNER).visible === false)

// ─── Closed locations ──────────────────────────────────────────────────────

const closedOnly = record({ id: 'a-closed', audienceType: 'location', audienceValues: ['b-closed'], resolvedBusinessIds: ['b-closed'] })
ok('an announcement addressed only to a closed shop is invisible', announcementReaches(closedOnly, OWNER).visible === false)

const sendToClosed = planDelivery({
  draft: { title: 'x', body: 'y', audience: { type: 'location', values: ['b-closed'] } },
  senderRole: 'ORGANIZATION_OWNER',
  senderBusinessIds: OWNER.businessIds,
  locations: LOCATIONS,
})
ok('a sender cannot address a closed location', sendToClosed.ok === false)
ok('the refusal names closed locations', /closed location/i.test(sendToClosed.errors.join(' ')))

const sendToEveryone = planDelivery({
  draft: { title: 'x', body: 'y', audience: { type: 'all', values: [] } },
  senderRole: 'ORGANIZATION_OWNER',
  senderBusinessIds: OWNER.businessIds,
  locations: LOCATIONS,
})
ok('sending to everyone excludes the closed shop', sendToEveryone.ok && !sendToEveryone.businessIds.includes('b-closed'))
ok('sending to everyone reaches the three open shops', sendToEveryone.businessIds.length === 3)

// ─── Wrong organization ────────────────────────────────────────────────────

const foreign = record({ id: 'a-foreign', organizationId: 'org-2' })
const foreignReach = announcementReaches(foreign, OWNER)
ok('an announcement from another organization is invisible', foreignReach.visible === false)
ok('the refusal names the other organization', /another organization/i.test(foreignReach.reason))
ok('a foreign announcement is not markable as read', markReadVerdict(foreign, OWNER).visible === false)

// ─── Read status isolation ────────────────────────────────────────────────

const shared = [record({ id: 'a-1' }), record({ id: 'a-2', title: 'Stock count' })]

const westInbox = buildInbox(shared, { 'a-1': '2026-11-23T19:00:00.000Z' }, WEST_MANAGER, {
  'b-downtown': 'Downtown',
  'b-airport': 'Airport',
})
ok('a receipt makes that announcement read', westInbox.items.find((item) => item.id === 'a-1')?.isNew === false)
ok('another announcement stays new', westInbox.items.find((item) => item.id === 'a-2')?.isNew === true)
ok('the unread count counts only unread items', westInbox.unread === 1 && unreadCount(westInbox.items) === 1)

// The caller loads receipts with a userId filter, so a map built for one person is never
// handed to another. This proves the function has no hidden shared state.
const barberInbox = buildInbox(shared, {}, DOWNTOWN_BARBER)
ok("another person's receipt is not carried into this inbox", barberInbox.items.every((item) => item.isNew) === true)
ok('the west manager still sees their own receipt', westInbox.items.find((item) => item.id === 'a-1')?.isNew === false)

const ownerInbox = buildInbox(shared, {}, OWNER)
ok('no receipts means everything is new', ownerInbox.unread === 2)

const eastInbox = buildInbox(shared, {}, EAST_MANAGER)
ok('an inbox hides announcements addressed to other locations', eastInbox.items.length === 0)
ok('hidden announcements are counted, not silently dropped', eastInbox.hidden === 2)

ok('a read mark is refused for an announcement outside the reader’s locations', markReadVerdict(record(), EAST_MANAGER).visible === false)
ok('a read mark is allowed for an addressed announcement', markReadVerdict(record(), DOWNTOWN_BARBER).visible === true)
ok('a read mark is refused without the read capability', markReadVerdict(record(), CUSTOMER).visible === false)

// ─── Unauthorized senders ─────────────────────────────────────────────────

for (const role of ['BARBER', 'CUSTOMER', 'FRANCHISE_OWNER', 'LOCATION_MANAGER'] as const) {
  const plan = planDelivery({
    draft: { title: 'x', body: 'y', audience: { type: 'all', values: [] } },
    senderRole: role,
    senderBusinessIds: ['b-downtown'],
    locations: LOCATIONS,
  })
  ok(`${role} cannot send an announcement`, plan.ok === false && /role cannot send/i.test(plan.errors.join(' ')))
}

const scopePlan = planDelivery({
  draft: { title: 'x', body: 'y', audience: { type: 'all', values: [] } },
  senderRole: 'REGIONAL_MANAGER',
  senderBusinessIds: WEST_MANAGER.businessIds,
  locations: LOCATIONS,
})
ok('"everyone" from a regional manager stays inside their regions', scopePlan.ok && !scopePlan.businessIds.includes('b-harbor'))
ok('the send plan explains the scope', /Every open location \(2\)/.test(scopePlan.explanation))

const outsideScope = planDelivery({
  draft: { title: 'x', body: 'y', audience: { type: 'location', values: ['b-harbor'] } },
  senderRole: 'REGIONAL_MANAGER',
  senderBusinessIds: WEST_MANAGER.businessIds,
  locations: LOCATIONS,
})
ok('a sender cannot reach a location outside their scope', outsideScope.ok === false && outsideScope.businessIds.length === 0)

const mixedScope = planDelivery({
  draft: { title: 'x', body: 'y', audience: { type: 'location', values: ['b-downtown', 'b-harbor'] } },
  senderRole: 'CORPORATE_ADMIN',
  senderBusinessIds: ['b-downtown'],
  locations: LOCATIONS,
})
ok('an out-of-scope location is dropped, not sent', mixedScope.ok && mixedScope.businessIds.join(',') === 'b-downtown')
ok('the dropped location is reported', mixedScope.dropped === 1 && /left out/i.test(mixedScope.explanation))

const missingTitle = planDelivery({
  draft: { title: '  ', body: 'y', audience: { type: 'all', values: [] } },
  senderRole: 'ORGANIZATION_OWNER',
  senderBusinessIds: OWNER.businessIds,
  locations: LOCATIONS,
})
ok('an empty title is refused', missingTitle.ok === false && /title/i.test(missingTitle.errors.join(' ')))

const noTarget = planDelivery({
  draft: { title: 'x', body: 'y', audience: { type: 'region', values: ['North'] } },
  senderRole: 'ORGANIZATION_OWNER',
  senderBusinessIds: OWNER.businessIds,
  locations: LOCATIONS,
})
ok('an audience that matches nothing is refused', noTarget.ok === false)

const groupPlan = planDelivery({
  draft: { title: 'x', body: 'y', audience: { type: 'group', values: ['b-airport'] } },
  senderRole: 'ORGANIZATION_OWNER',
  senderBusinessIds: OWNER.businessIds,
  locations: LOCATIONS,
})
ok('a named group is preserved through the send plan', groupPlan.ok && groupPlan.businessIds.join(',') === 'b-airport')

// ─── Wording ──────────────────────────────────────────────────────────────

ok('everyone is described plainly', audienceLabel('all', []) === 'Every open location')
ok('a region is named', audienceLabel('region', ['West']) === 'Region: West')
ok('known locations are named', audienceLabel('location', ['b-downtown'], { 'b-downtown': 'Downtown' }) === 'Downtown')
ok(
  'unknown locations are counted, never guessed',
  audienceLabel('location', ['b-downtown', 'b-harbor'], { 'b-downtown': 'Downtown' }) === 'Downtown and 1 more',
)
ok('a named group without visible names stays general', audienceLabel('group', ['b-x']) === 'A named group of locations')
ok('an unrecorded audience says so', audienceLabel('mystery', []) === 'Audience not recorded')
ok('a date is written for a person', sentOnWords('2026-11-23T18:00:00.000Z').includes('2026'))
ok('a missing date is not invented', sentOnWords(null) === 'date not recorded')

// ─── Empty states ─────────────────────────────────────────────────────────

ok('a role without the capability is told why', /role does not include/i.test(emptyStateMessage(CUSTOMER, 0)))
ok('a person with no location is told what to do', /not assigned to an open location/i.test(emptyStateMessage({ ...OWNER, businessIds: [] }, 0)))
ok('an organization with nothing sent says so', /Nothing has been sent/i.test(emptyStateMessage(OWNER, 0)))
ok('an inbox with nothing addressed to you says so', /Nothing is addressed to you/i.test(emptyStateMessage(OWNER, 4)))
ok('an empty inbox is never a blank page', emptyStateMessage(OWNER, 0).length > 40)

// ─── The server boundary, checked in source ───────────────────────────────

const ROOT = join(__dirname, '..')
function source(path: string): string {
  try {
    return readFileSync(join(ROOT, path), 'utf8')
  } catch {
    ok(`file exists: ${path}`, false)
    return ''
  }
}

const listRoute = source('src/app/api/dashboard/organization/announcements/route.ts')
const readRoute = source('src/app/api/dashboard/organization/announcements/[id]/read/route.ts')
const page = source('src/app/(dashboard)/dashboard/organization/announcements/page.tsx')
const inbox = source('src/components/organization/AnnouncementInbox.tsx')
const sidebar = source('src/components/dashboard/Sidebar.tsx')
const schema = source('prisma/schema.prisma')

ok('the inbox route resolves the organization from the session', listRoute.includes('resolveOrganizationContext(auth.user.id)'))
ok('the inbox route never reads an organization id from the request', !/searchParams\.get\(['"]organization/i.test(listRoute))
ok('the read route resolves the organization from the session', readRoute.includes('resolveOrganizationContext(auth.user.id)'))
ok('the read route writes the receipt for the session user only', readRoute.includes('auth.user.id'))
ok('the read route takes no recipient from the body', !readRoute.includes('req.json()'))
const delivery = source('src/lib/organization/announcement-delivery.ts')
ok('receipts are read with a userId filter', /where: \{ userId, organizationId/.test(delivery))
ok('the announcement lookup is scoped to the resolved organization', /where: \{ id: announcementId, organizationId: context.organizationId \}/.test(delivery))
ok('sending is refused before anything is written', delivery.indexOf('if (!plan.ok)') < delivery.indexOf('organizationAnnouncement.create'))
ok('the page resolves the organization from the session', page.includes('resolveOrganizationContext(auth.user.id)'))
ok('the page reads no organization id from the URL', !page.includes('searchParams'))
ok('the page checks the read capability before loading', page.includes("can(context.role, 'announcements.read')"))
ok('the page checks the send capability before offering the form', page.includes("can(context.role, 'announcements.send')"))
ok('the page never injects announcement HTML', !page.includes('dangerouslySetInnerHTML') && !inbox.includes('dangerouslySetInnerHTML'))
ok('the announcement body is rendered as text', inbox.includes('whitespace-pre-line'))
ok('no external delivery is wired in', !/sendEmail|sendSms|nodemailer|twilio/i.test(listRoute + page + inbox))

// ─── Mobile and accessibility (static guard, not a screen-reader audit) ───

ok('the inbox announces changes politely', inbox.includes('aria-live="polite"'))
ok('failures are announced as alerts', inbox.includes('role="alert"'))
ok('read marks are described for each announcement', /aria-label=\{`Mark/.test(inbox))
ok('tap targets meet the 44px guidance', (inbox.match(/min-h-11/g) ?? []).length >= 5)
ok('controls stack on a phone and sit side by side when wider', inbox.includes('flex-col') && inbox.includes('sm:flex-row'))
ok('long titles and bodies wrap instead of overflowing', inbox.includes('break-words'))
ok('the audience choice is a labelled fieldset', inbox.includes('<fieldset') && inbox.includes('<legend'))
ok('each text input has an associated label', inbox.includes('htmlFor="announcement-title"') && inbox.includes('htmlFor="announcement-body"'))
ok('the title input carries its id', /id="announcement-title"/.test(inbox))
ok('the message field carries its id', /id="announcement-body"/.test(inbox))
ok('the sent date is marked up as a time element', inbox.includes('<time dateTime='))
ok('the inbox is a semantic list', inbox.includes('<ul') && inbox.includes('<li'))
ok('no click handler is attached to a bare div', !/<div[^>]*onClick/.test(inbox))
ok('the send action needs a second click', inbox.includes('Review before sending') && /onClick=\{send\}/.test(inbox))
ok('the page has a top-level heading', (page.match(/<h1/g) ?? []).length >= 1)
ok('the client component starts at h2, never a second h1', !inbox.includes('<h1') && inbox.includes('<h2'))
ok('the page renders the inbox component', page.includes('AnnouncementInbox'))
ok('the inbox is reachable from the owner sidebar', /name: 'Announcements', href: '\/dashboard\/organization\/announcements'/.test(sidebar))
ok('the inbox is reachable from the barber sidebar', (sidebar.match(/href: '\/dashboard\/organization\/announcements'/g) ?? []).length === 2)

// ─── Schema support for read status ───────────────────────────────────────

ok('the read receipt is unique per person and announcement', schema.includes('@@unique([announcementId, userId])'))
ok('the receipt carries the organization for isolation', /model OrganizationAnnouncementRead[\s\S]*organizationId String/.test(schema))
ok('the delivered set is stored on the announcement', schema.includes('resolvedBusinessIds String[]'))
ok('a receipt is deleted with its announcement', /announcement\s+OrganizationAnnouncement\s+@relation\([^)]*onDelete: Cascade/.test(schema))

console.log(`\nOrganization announcement inbox: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
