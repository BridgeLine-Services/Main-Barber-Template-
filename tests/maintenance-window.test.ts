/**
 * Part 5.5: routine maintenance must not interrupt the shop.
 *
 * The important behaviour is what happens when the information is missing. A shop whose
 * hours cannot be read must not be treated as closed, and a repair that changes the running
 * system must never be described as safe just because it is after hours.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isOpenAt, decideWindow, isForbiddenAutomatic, type WeeklyHours } from '../src/lib/platform-reliability/maintenance-window'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')
/** 2026-11-20 is a Friday. */
const fridayAt = (h: number, m = 0) => new Date(2026, 10, 20, h, m, 0)
const shop: WeeklyHours = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: { open: '09:00', close: '18:00' },
  wednesday: { open: '09:00', close: '18:00' },
  thursday: { open: '09:00', close: '18:00' },
  friday: { open: '09:00', close: '18:00' },
  saturday: { open: '10:00', close: '16:00' },
  sunday: { isOff: true },
}

// ─── Reading the hours ─────────────────────────────────────────────────────

ok('open in the middle of the day', isOpenAt(shop, fridayAt(12)) === true)
ok('closed before opening', isOpenAt(shop, fridayAt(8, 59)) === false)
ok('open exactly at opening time', isOpenAt(shop, fridayAt(9)) === true)
ok('closed exactly at closing time', isOpenAt(shop, fridayAt(18)) === false)
ok('a day marked off is closed', isOpenAt(shop, new Date(2026, 10, 22, 12)) === false)
ok('no hours at all is unknown, not closed', isOpenAt(null, fridayAt(12)) === null)
ok('a missing day is unknown, not closed', isOpenAt({ friday: { open: '09:00', close: '18:00' } }, new Date(2026, 10, 21, 12)) === null)
ok('an unreadable open time is unknown', isOpenAt({ friday: { open: 'nine', close: '18:00' } }, fridayAt(12)) === null)
ok('an impossible time is unknown', isOpenAt({ friday: { open: '25:00', close: '18:00' } }, fridayAt(12)) === null)
ok('a missing close time is unknown', isOpenAt({ friday: { open: '09:00' } }, fridayAt(12)) === null)

// ─── The decision ──────────────────────────────────────────────────────────

const safe = decideWindow('automatic', shop, fridayAt(12))
ok('a read-only check may run while open', safe.decision === 'run-now')
ok('it says why in plain words', /only reads and checks/i.test(safe.sentence), safe.sentence)

const riskyOpen = decideWindow('approval', shop, fridayAt(12))
ok('a changing repair waits while the shop is open', riskyOpen.decision === 'wait-for-quiet')
ok('it names the risk to bookings', /booking|payment/i.test(riskyOpen.sentence), riskyOpen.sentence)

const riskyClosed = decideWindow('approval', shop, fridayAt(20))
ok('a changing repair waits for approval even after hours', riskyClosed.decision === 'wait-for-quiet')
ok('after hours still requires approval', /approval/i.test(riskyClosed.sentence), riskyClosed.sentence)
ok('after hours still requires a backup when the database is involved', /backup/i.test(riskyClosed.sentence), riskyClosed.sentence)

const riskyUnknown = decideWindow('approval', null, fridayAt(12))
ok('unknown hours mean wait, not go', riskyUnknown.decision === 'wait-for-quiet')
ok('unknown hours are stated, not hidden', /could not read your opening hours/i.test(riskyUnknown.sentence), riskyUnknown.sentence)
ok('unknown hours point at the fix', /setting your hours/i.test(riskyUnknown.sentence))

const specialist = decideWindow('manual', shop, fridayAt(20))
ok('a specialist repair is never automatic', specialist.decision === 'never-automatic')
ok('it says a specialist handles it', /specialist/i.test(specialist.sentence))
ok('it does not promise it will run when closed', !/good time/i.test(specialist.sentence))
ok('the helper agrees', isForbiddenAutomatic('manual') === true && isForbiddenAutomatic('approval') === false)

ok('every decision is one of three known answers', ['run-now', 'wait-for-quiet', 'never-automatic'].includes(safe.decision) && ['run-now', 'wait-for-quiet', 'never-automatic'].includes(riskyOpen.decision) && ['run-now', 'wait-for-quiet', 'never-automatic'].includes(specialist.decision))

// ─── It cannot do anything ─────────────────────────────────────────────────

const source = readFileSync(join(ROOT, 'src/lib/platform-reliability/maintenance-window.ts'), 'utf8')
ok('the window module imports no database client', !/prisma|@prisma\/client/.test(source))
ok('the window module performs no writes', !/\.create\(|\.update\(|writeFileSync/.test(source))
ok('the window module runs nothing', !/child_process|execSync|spawn\(/.test(source))
ok('the window module makes no network calls', !/\bfetch\(/.test(source))
ok('it never says a database change is safe to run unattended', !/safe to run now/i.test(source))

console.log(`\nMaintenance window: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
