/**
 * Dependency support status (Section 14.1).
 *
 * The page used to pass `supported: null` for everything, so a supported stack and an
 * unverified one looked identical. These tests pin the three-way answer and the fact that
 * "we cannot say" is still available rather than being flattened to a healthy status.
 */

import { readFileSync } from 'node:fs'
import { COMPATIBILITY_RULES, checkComponent, supportedFlag } from '../src/lib/platform-reliability/compatibility'

let p = 0
const f: string[] = []
const ok = (name: string, cond: boolean) => { if (cond) p++; else f.push(name) }

ok('a supported Next.js answers yes', supportedFlag('next', '16.4.6') === true)
ok('an older Next.js answers no', supportedFlag('next', '15.0.0') === false)
ok('an unreadable version answers unknown', supportedFlag('next', null) === null)
ok('garbage answers unknown', supportedFlag('next', 'not-a-version') === null)
ok('React is judged too', supportedFlag('react', '19.3.0') === true)
ok('Prisma is judged too', supportedFlag('prisma', '6.19.3') === true)
ok('Node is judged too', supportedFlag('node', 'v24.22.1') === true)
ok('an old Node answers no', supportedFlag('node', 'v18.0.0') === false)
ok('PostgreSQL 16 is inside the tested line', supportedFlag('postgres', '16.1') === true)
ok('PostgreSQL 18 is outside it', supportedFlag('postgres', '18.0') === false)
ok('a component with no rule is unknown, not healthy', supportedFlag('mystery-package', '1.0.0') === null)

const rules = COMPATIBILITY_RULES.map((r) => r.component)
ok('the runtime is covered', rules.includes('node'))
ok('the framework is covered', rules.includes('next'))
ok('the database toolkit is covered', rules.includes('prisma'))
ok('PostgreSQL is covered', rules.includes('postgres'))
ok('every rule names its source', COMPATIBILITY_RULES.every((r) => typeof r.source === 'string' && r.source.length > 0))
ok('an unsupported component says so in words', checkComponent(COMPATIBILITY_RULES[1], '15.0.0').status === 'unsupported')
ok('an unreadable component says unknown in words', checkComponent(COMPATIBILITY_RULES[1], '').status === 'unknown')

const page = readFileSync('src/app/(dashboard)/dashboard/reliability/page.tsx', 'utf8')
ok('the page no longer hardcodes null', !page.includes('supported: null'))
ok('the page uses the rules', page.includes('supportedFlag('))
ok('the page still reads real installed versions', page.includes('package-lock.json'))

console.log('\nDependency support status: ' + p + ' passed, ' + f.length + ' failed')
if (f.length) { f.forEach((n) => console.log('  FAIL ' + n)); process.exit(1) }
