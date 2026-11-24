/**
 * Staff assignment rules, pinned.
 *
 * The refusals carry the weight: no self-assignment, no closed location, no overlap, no
 * scope escape, and no delete when an assignment ends. The concurrency case is modelled by
 * handing the same candidate to the planner twice, which is what the loser of a race sees.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assignmentRows,
  assignmentState,
  groupByState,
  planAssignment,
  planEndAssignment,
  planTransfer,
  type AssignmentActor,
  type LocationState,
} from '../src/lib/organization/assignment-management'
import type { Assignment } from '../src/lib/organization/assignments'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log('  FAIL ' + name + (detail ? ' - ' + detail : ''))
}

const ROOT = join(__dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const AT = new Date('2026-11-24T12:00:00.000Z')
const owner: AssignmentActor = { userId: 'owner-1', role: 'ORGANIZATION_OWNER', allowedBusinessIds: ['b1', 'b2', 'b3'] }
const regional: AssignmentActor = { userId: 'rm-1', role: 'REGIONAL_MANAGER', allowedBusinessIds: ['b1'] }
const barber: AssignmentActor = { userId: 'barb-1', role: 'BARBER', allowedBusinessIds: ['b1'] }

const locations: LocationState[] = [
  { businessId: 'b1', name: 'Downtown', status: 'active' },
  { businessId: 'b2', name: 'Airport', status: 'active' },
  { businessId: 'b3', name: 'Harbor', status: 'closed' },
]

const live: Assignment = {
  id: 'a1', userId: 'staff-1', businessId: 'b1', role: 'BARBER',
  effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, createdById: 'owner-1',
}

const candidate = {
  userId: 'staff-2', businessId: 'b1', role: 'BARBER',
  effectiveFrom: '2026-11-01T00:00:00.000Z', effectiveTo: null,
}

// --- who may assign ---------------------------------------------------------

const byBarber = planAssignment({ candidate, existing: [], actor: barber, locations, at: AT })
ok('a barber cannot assign', !byBarber.ok)
ok('the refusal is about the role', /role cannot assign/i.test(byBarber.errors[0]))
const byFranchise = planAssignment({ candidate, existing: [], actor: { ...owner, role: 'FRANCHISE_OWNER' }, locations, at: AT })
ok('a franchise owner cannot assign', !byFranchise.ok)
ok('an owner may assign', planAssignment({ candidate, existing: [], actor: owner, locations, at: AT }).ok)
ok('a regional manager may assign inside their region', planAssignment({ candidate, existing: [], actor: regional, locations, at: AT }).ok)

// --- scope and location state ----------------------------------------------

const outOfScope = planAssignment({ candidate: { ...candidate, businessId: 'b2' }, existing: [], actor: regional, locations, at: AT })
ok('a regional manager cannot assign outside their region', !outOfScope.ok)
ok('the scope refusal says so', /outside the locations you look after/i.test(outOfScope.errors[0]))
const closed = planAssignment({ candidate: { ...candidate, businessId: 'b3' }, existing: [], actor: owner, locations, at: AT })
ok('a closed location takes no assignment', !closed.ok)
ok('the closed refusal names the location', /Harbor is closed/.test(closed.errors[0]))

// --- self-assignment --------------------------------------------------------

const self = planAssignment({ candidate: { ...candidate, userId: 'rm-1' }, existing: [], actor: regional, locations, at: AT })
ok('nobody can assign themselves', !self.ok)
ok('the self refusal explains what to do', /Ask another owner/.test(self.errors[0]))
const ownerSelf = planAssignment({ candidate: { ...candidate, userId: 'owner-1' }, existing: [], actor: owner, locations, at: AT })
ok('an owner cannot self-assign either', !ownerSelf.ok)

// --- validation -------------------------------------------------------------

ok('a bad role is refused', !planAssignment({ candidate: { ...candidate, role: 'SUPERUSER' }, existing: [], actor: owner, locations, at: AT }).ok)
ok('a missing person is refused', !planAssignment({ candidate: { ...candidate, userId: '' }, existing: [], actor: owner, locations, at: AT }).ok)
ok('an end before the start is refused', !planAssignment({ candidate: { ...candidate, effectiveTo: '2026-10-01T00:00:00.000Z' }, existing: [], actor: owner, locations, at: AT }).ok)

// --- overlap ----------------------------------------------------------------

const overlap = planAssignment({
  candidate: { ...candidate, userId: 'staff-1', effectiveFrom: '2026-02-01T00:00:00.000Z' },
  existing: [live], actor: owner, locations, at: AT,
})
ok('an overlapping assignment is refused', !overlap.ok)
ok('the overlap refusal names the dates', /2026-01-01/.test(overlap.errors[0]))
ok('an overlap is refused even for a different role', !planAssignment({
  candidate: { ...candidate, userId: 'staff-1', role: 'LOCATION_MANAGER', effectiveFrom: '2026-03-01T00:00:00.000Z' },
  existing: [live], actor: owner, locations, at: AT,
}).ok)
ok('a later start after an ended assignment is allowed', planAssignment({
  candidate: { ...candidate, userId: 'staff-1', effectiveFrom: '2026-06-01T00:00:00.000Z' },
  existing: [{ ...live, effectiveTo: '2026-05-01T00:00:00.000Z' }], actor: owner, locations, at: AT,
}).ok)

// The same candidate twice: the first wins, the second is refused. That is the loser of a
// race, and it must be a refusal rather than a second row.
const raceWinner = planAssignment({ candidate, existing: [], actor: owner, locations, at: AT })
const raceLoser = planAssignment({
  candidate,
  existing: [{ id: 'a9', ...candidate, effectiveTo: null, createdById: 'owner-1' }],
  actor: owner, locations, at: AT,
})
ok('the first of two identical requests is accepted', raceWinner.ok)
ok('the second of two identical requests is refused', !raceLoser.ok)
ok('the refusal is an overlap, not a crash', /already has/i.test(raceLoser.errors[0]))

// --- transfers --------------------------------------------------------------

const transfer = planTransfer({ assignment: live, destinationBusinessId: 'b2', effectiveFrom: '2026-12-01T00:00:00.000Z', existing: [live], actor: owner, locations })
ok('a clean transfer is planned', transfer.ok)
ok('a transfer is two operations', transfer.operations.length === 2)
ok('the old assignment is ended, not deleted', transfer.operations[0].kind === 'end' && transfer.operations[0].assignmentId === 'a1')
ok('the old assignment ends on the transfer date', transfer.operations[0].effectiveTo === '2026-12-01T00:00:00.000Z')
ok('the new assignment starts the same day', transfer.operations[1].kind === 'start' && transfer.operations[1].effectiveFrom === '2026-12-01T00:00:00.000Z')
ok('the explanation says access changes on the date', /From 2026-12-01/.test(transfer.explanation))
ok('the explanation mentions the old location access ending', /lose access to the old location/i.test(transfer.explanation))
ok('a transfer to the same location is refused', !planTransfer({ assignment: live, destinationBusinessId: 'b1', effectiveFrom: '2026-12-01T00:00:00.000Z', existing: [live], actor: owner, locations }).ok)
ok('a transfer to a closed location is refused', !planTransfer({ assignment: live, destinationBusinessId: 'b3', effectiveFrom: '2026-12-01T00:00:00.000Z', existing: [live], actor: owner, locations }).ok)
ok('a transfer outside the actor scope is refused', !planTransfer({ assignment: live, destinationBusinessId: 'b2', effectiveFrom: '2026-12-01T00:00:00.000Z', existing: [live], actor: regional, locations }).ok)
ok('a transfer of an ended assignment is refused', !planTransfer({ assignment: { ...live, effectiveTo: '2026-02-01T00:00:00.000Z' }, destinationBusinessId: 'b2', effectiveFrom: '2026-12-01T00:00:00.000Z', existing: [live], actor: owner, locations }).ok)
ok('a transfer into an overlapping destination is refused', !planTransfer({
  assignment: live, destinationBusinessId: 'b2', effectiveFrom: '2026-12-01T00:00:00.000Z',
  existing: [live, { id: 'a2', userId: 'staff-1', businessId: 'b2', role: 'BARBER', effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: null, createdById: 'owner-1' }],
  actor: owner, locations,
}).ok)
ok('a barber cannot transfer anybody', !planTransfer({ assignment: live, destinationBusinessId: 'b2', effectiveFrom: '2026-12-01T00:00:00.000Z', existing: [live], actor: barber, locations }).ok)

// --- ending -----------------------------------------------------------------

const ended = planEndAssignment(live, owner, AT)
ok('ending an active assignment is allowed', ended.ok)
ok('ending sets an end date rather than removing it', ended.effectiveTo === AT.toISOString())
ok('a barber cannot end an assignment', !planEndAssignment(live, barber, AT).ok)
ok('a regional manager cannot end outside their scope', !planEndAssignment({ ...live, businessId: 'b2' }, regional, AT).ok)
ok('ending twice says nothing changed', /already ended/.test(planEndAssignment({ ...live, effectiveTo: '2026-03-01T00:00:00.000Z' }, owner, AT).errors[0]))

// --- history ----------------------------------------------------------------

const history: Assignment[] = [
  live,
  { id: 'a2', userId: 'staff-1', businessId: 'b2', role: 'LOCATION_MANAGER', effectiveFrom: '2026-12-01T00:00:00.000Z', effectiveTo: null, createdById: 'owner-1' },
  { id: 'a3', userId: 'staff-1', businessId: 'b1', role: 'BARBER', effectiveFrom: '2024-01-01T00:00:00.000Z', effectiveTo: '2025-01-01T00:00:00.000Z', createdById: 'owner-1' },
]
ok('a live assignment is current', assignmentState(live, AT) === 'current')
ok('a future assignment is upcoming', assignmentState(history[1], AT) === 'upcoming')
ok('a finished assignment is ended', assignmentState(history[2], AT) === 'ended')

const rows = assignmentRows(history, locations, AT)
ok('history keeps every row', rows.length === 3)
ok('history is newest first', rows[0].effectiveFrom.startsWith('2026-12'))
ok('an ended row is not hidden', rows.some((row) => row.state === 'ended'))
ok('the location name is carried', rows.some((row) => row.businessName === 'Airport'))
ok('the role is written in words', rows.some((row) => row.roleWords === 'Location manager'))
ok('state words are readable', rows.every((row) => ['In force now', 'Starts later', 'Ended'].includes(row.stateWords)))
const grouped = groupByState(rows)
ok('grouping keeps one current row', grouped.current.length === 1)
ok('grouping keeps one upcoming row', grouped.upcoming.length === 1)
ok('grouping keeps one ended row', grouped.ended.length === 1)

// --- the server boundary ----------------------------------------------------

const service = read('src/lib/organization/assignment-service.ts')
ok('assignment writes are serializable', (service.match(/isolationLevel: 'Serializable'/g) ?? []).length === 2)
ok('the assignment service never deletes a row', !/staffLocationAssignment\.delete/.test(service))
ok('ending writes an end date', /effectiveTo: new Date\(plan\.effectiveTo as string\)/.test(service))
ok('a transfer writes both halves in one transaction', /assignment\.transfer/.test(service) && /\$transaction/.test(service))
ok('the overlap is re-checked inside the transaction', /findFirst\(\{/.test(service) && /OVERLAP/.test(service))
ok('every assignment write is audited', (service.match(/organizationConfigAudit\.create/g) ?? []).length >= 3)

for (const path of ['src/app/api/dashboard/organization/assignments/route.ts', 'src/app/api/dashboard/organization/assignments/[id]/route.ts']) {
  const source = read(path)
  ok(path + ' resolves the organization from the session', source.includes('resolveOrganizationContext(auth.user.id)'))
  ok(path + ' never takes an organization id from the body', !/body\.organizationId/.test(source))
}

console.log('')
console.log('Staff assignments: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)
