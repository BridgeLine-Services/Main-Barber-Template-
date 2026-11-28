import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dashboardRoleLabel, ROLE_LABEL, roleLabel } from '../src/lib/role-labels'

const root = join(__dirname, '..')
const dashboardLayout = readFileSync(join(root, 'src/app/(dashboard)/dashboard/layout.tsx'), 'utf8')
const sidebar = readFileSync(join(root, 'src/components/dashboard/Sidebar.tsx'), 'utf8')

test('supported account roles have their intended display labels', () => {
  assert.equal(roleLabel('OWNER'), 'Owner')
  assert.equal(roleLabel('BUSINESS_ADMIN'), 'Co-owner')
  assert.equal(roleLabel('BARBER'), 'Barber')
  assert.equal(roleLabel('CUSTOMER'), 'Customer')
  assert.equal(roleLabel('PLATFORM_OWNER'), 'Platform Owner')
})

test('organization roles do not claim single-business ownership', () => {
  assert.equal(dashboardRoleLabel('OWNER', 'CORPORATE_ADMIN'), 'Corporate administrator')
  assert.equal(dashboardRoleLabel('OWNER', 'ORGANIZATION_OWNER'), 'Organization owner')
  assert.notEqual(dashboardRoleLabel('OWNER', 'CORPORATE_ADMIN'), 'Owner')
})

test('a barber account displays its organization management role when applicable', () => {
  assert.equal(dashboardRoleLabel('BARBER', 'REGIONAL_MANAGER'), 'Regional manager')
  assert.equal(dashboardRoleLabel('BARBER', 'LOCATION_MANAGER'), 'Location manager')
  assert.equal(dashboardRoleLabel('BARBER', 'BARBER'), 'Barber')
})

test('unknown roles fail safely without exposing the identifier', () => {
  assert.equal(roleLabel('UNRECOGNISED_INTERNAL_ROLE'), 'User')
  assert.equal(dashboardRoleLabel('UNRECOGNISED_INTERNAL_ROLE', null), 'User')
  assert.equal(dashboardRoleLabel('BARBER', 'UNRECOGNISED_INTERNAL_ROLE'), 'User')
})

test('all configured role labels are human-readable', () => {
  for (const [role, label] of Object.entries(ROLE_LABEL)) {
    assert.ok(!label.includes('_'), `label for ${role} must not contain an underscore: ${label}`)
    assert.ok(label !== label.toUpperCase(), `label for ${role} must not shout the identifier: ${label}`)
  }
})

test('dashboard header and sidebar use the same behavior-tested role helper', () => {
  assert.match(dashboardLayout, /dashboardRoleLabel\(userRole,\s*organizationRole\)/)
  assert.match(sidebar, /const displayedRole = dashboardRoleLabel\(userRole, organizationRole\)/)
  assert.match(sidebar, /\{displayedRole\} Dashboard/)
  assert.match(sidebar, /\{displayedRole\} portal/)
})
