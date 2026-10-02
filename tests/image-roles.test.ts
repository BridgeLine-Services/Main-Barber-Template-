/**
 * Section: Image-role system + focal points (visual experience gap B5).
 *
 * Proves the focal-point contract end-to-end at the unit level:
 *  - every declared image role has a complete, sane rendering spec
 *  - focal values are clamped to 0-100 and rendered as an inline style
 *  - missing/partial focal data returns undefined so the role's default
 *    position CLASS stays applied (Tailwind JIT can't see runtime values,
 *    so focal must be a style, never an arbitrary class)
 *
 * Run: npx tsx tests/image-roles.test.ts  (no server or database needed)
 */
import { IMAGE_ROLES, focalPositionStyle, type ImageRole } from '../src/lib/image-roles'

let passed = 0
let failed = 0

function check(name: string, cond: boolean) {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.error(`  ❌ ${name}`)
  }
}

async function main() {
  console.log('▸ Image-role spec integrity')
  const roles = Object.keys(IMAGE_ROLES) as ImageRole[]
  check('all six roles are declared', roles.length === 6)
  for (const role of roles) {
    const spec = IMAGE_ROLES[role]
    check(`${role}: has an aspect class`, spec.aspect.startsWith('aspect-'))
    check(`${role}: fit is cover or contain`, spec.fit === 'cover' || spec.fit === 'contain')
    check(`${role}: fallback is gradient or initial`, spec.fallback === 'gradient' || spec.fallback === 'initial')
    check(`${role}: position default present`, spec.position.length > 0)
  }
  check('only the hero role is LCP-priority', roles.filter((r) => IMAGE_ROLES[r].priority).length === 1 && IMAGE_ROLES.hero.priority)

  console.log('▸ focalPositionStyle')
  check('missing both values → undefined (role class stays)', focalPositionStyle(null, null) === undefined)
  check('missing both values (undefined) → undefined', focalPositionStyle(undefined, undefined) === undefined)
  check('partial data (X only) → undefined', focalPositionStyle(30, null) === undefined)
  check('partial data (Y only) → undefined', focalPositionStyle(null, 70) === undefined)
  check('center → 50% 50%', focalPositionStyle(50, 50)?.objectPosition === '50% 50%')
  check('typical portrait crop', focalPositionStyle(30, 20)?.objectPosition === '30% 20%')

  console.log('▸ clamping')
  check('X below 0 clamps to 0', focalPositionStyle(-25, 50)?.objectPosition === '0% 50%')
  check('Y above 100 clamps to 100', focalPositionStyle(50, 250)?.objectPosition === '50% 100%')
  check('floats round to integers', focalPositionStyle(29.6, 70.4)?.objectPosition === '30% 70%')

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
