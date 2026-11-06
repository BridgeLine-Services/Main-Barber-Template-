/**
 * Regression guard for Correction A.
 *
 * Two separate surfaces showed the wrong thing to a co-owner:
 *
 *  1. The dashboard header badge printed `userRole.toLowerCase()`, so a co-owner
 *     saw the internal identifier `business_admin`.
 *  2. The sidebar footer decided between two hardcoded strings, "Owner" and
 *     "Barber", using `isOwner`. BUSINESS_ADMIN is inside isOwner because it
 *     shares the owner navigation, so a co-owner was labelled "Owner" — an
 *     ownership claim they do not hold.
 *
 * Both are asserted here by reading the components rather than rendering them,
 * because the failure mode is a string sitting in the source, and a source check
 * cannot drift the way a snapshot can. Rendering is covered separately by the
 * browser suite.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROLE_LABEL, roleLabel } from '../src/lib/role-labels'

const root = join(__dirname, '..')
const dashboardLayout = readFileSync(join(root, 'src/app/(dashboard)/dashboard/layout.tsx'), 'utf8')
const sidebar = readFileSync(join(root, 'src/components/dashboard/Sidebar.tsx'), 'utf8')

test('every supported role has a human label', () => {
  assert.equal(roleLabel('PLATFORM_OWNER'), 'Platform Owner')
  assert.equal(roleLabel('OWNER'), 'Owner')
  assert.equal(roleLabel('BUSINESS_ADMIN'), 'Co-owner', 'the co-owner case that was wrong')
  assert.equal(roleLabel('BARBER'), 'Barber')
  assert.equal(roleLabel('CUSTOMER'), 'Customer')
  assert.equal(roleLabel('PUBLIC_VISITOR'), 'Visitor')
})

test('no label exposes an internal identifier', () => {
  for (const [role, label] of Object.entries(ROLE_LABEL)) {
    assert.ok(!label.includes('_'), `label for ${role} must not contain an underscore: ${label}`)
    assert.ok(label !== label.toUpperCase(), `label for ${role} must not shout the identifier: ${label}`)
  }
})

test('dashboard header badge uses the shared label, not the raw identifier', () => {
  assert.ok(!dashboardLayout.includes('userRole.toLowerCase()'), 'raw role identifier is rendered again')
  assert.ok(dashboardLayout.includes('roleLabel(userRole)'), 'header badge must call roleLabel')
  assert.ok(/from '@\/lib\/role-labels'/.test(dashboardLayout), 'must import the shared label module')
})

test('sidebar shows the shared label instead of an Owner-vs-Barber guess', () => {
  assert.ok(sidebar.includes('roleLabel(userRole)'), 'sidebar must call roleLabel for the person role')
  assert.ok(!/>\s*Owner\s*<\/span>/.test(sidebar), 'a hardcoded Owner label reintroduces the co-owner bug')
})

test('a co-owner is never labelled Owner', () => {
  assert.notEqual(roleLabel('BUSINESS_ADMIN'), roleLabel('OWNER'))
  assert.equal(roleLabel('BUSINESS_ADMIN'), 'Co-owner')
})
