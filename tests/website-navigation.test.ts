/**
 * Website navigation (Section 8.1).
 *
 * The interesting cases are the refusals: a menu is a place where a well-meaning owner can
 * paste a `javascript:` address, point at another site, or duplicate a link.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  NAV_LINK_LIMIT,
  describeNavigation,
  isInternalNavigationHref,
  isSafeNavigationHref,
  moveNavigationItem,
  normaliseNavigation,
  parseNavigation,
  validateNavigation,
  visibleNavigation,
  type NavLink,
} from '../src/lib/website-navigation'

const root = join(__dirname, '..')
let p = 0
let f = 0
const ok = (name: string, condition: boolean) => {
  if (condition) p += 1
  else { f += 1; console.log('  FAIL', name) }
}
const link = (label: string, href: string, visible = true): NavLink => ({ label, href, visible })

// --- addresses ---
ok('a page on this site is allowed', isSafeNavigationHref('/services'))
ok('the home page is allowed', isSafeNavigationHref('/'))
ok('a query and hash are allowed', isSafeNavigationHref('/book?service=1#top'))
ok('a protocol relative address is refused', !isSafeNavigationHref('//evil.example'))
ok('javascript is refused', !isSafeNavigationHref('javascript:alert(1)'))
ok('data is refused', !isSafeNavigationHref('data:text/html,<script>'))
ok('plain http is refused', !isSafeNavigationHref('http://example.com'))
ok('https is allowed', isSafeNavigationHref('https://example.com/menu'))
ok('a bare word is refused', !isSafeNavigationHref('services'))
ok('an empty address is refused', !isSafeNavigationHref('   '))
ok('an absurdly long address is refused', !isSafeNavigationHref('/' + 'a'.repeat(400)))
ok('internal detection matches the leading slash only', isInternalNavigationHref('/about') && !isInternalNavigationHref('https://example.com'))

// --- reading stored values ---
ok('junk reads as no menu', parseNavigation('nonsense').length === 0)
ok('null reads as no menu', parseNavigation(null).length === 0)
ok('an object is not a list', parseNavigation({ label: 'x' }).length === 0)
const stored = parseNavigation([{ label: 'Book', href: '/book' }, { label: '', href: '/x' }, null, { label: 'No href' }])
ok('only complete rows survive', stored.length === 1 && stored[0].label === 'Book')
ok('a missing visible flag means shown', stored[0].visible === true)
ok('hidden is remembered', parseNavigation([{ label: 'x', href: '/x', visible: false }])[0].visible === false)
ok('a long stored list is capped', parseNavigation(Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, href: `/p${i}` }))).length === NAV_LINK_LIMIT)

// --- validation ---
ok('no menu is valid', validateNavigation([]).valid)
ok('a good menu is valid', validateNavigation([link('Home', '/'), link('Book', '/book')]).valid)
ok('too many links are refused', !validateNavigation(Array.from({ length: 13 }, (_, i) => link(`L${i}`, `/p${i}`))).valid)
ok('a missing name is refused', !validateNavigation([link('', '/book')]).valid)
ok('a long name is refused', !validateNavigation([link('x'.repeat(40), '/book')]).valid)
ok('a duplicate address is refused', !validateNavigation([link('Book', '/book'), link('Booking', '/book')]).valid)
ok('a duplicate address in another case is refused', !validateNavigation([link('A', '/Book'), link('B', '/book')]).valid)
ok('a duplicate name is refused', !validateNavigation([link('Book', '/book'), link('Book', '/book2')]).valid)
const unsafe = validateNavigation([link('Bad', 'javascript:alert(1)')])
ok('an unsafe address is refused', !unsafe.valid)
ok('the refusal explains what is allowed', /starting with \//.test(unsafe.errors[0]))

// --- tidying and ordering ---
const tidy = normaliseNavigation([link('  Home  ', '  /  ')])
ok('names and addresses are trimmed', tidy[0].label === 'Home' && tidy[0].href === '/')
ok('long names are cut to the limit', normaliseNavigation([link('x'.repeat(60), '/')])[0].label.length === 32)
const three = [link('A', '/a'), link('B', '/b'), link('C', '/c')]
ok('moving up swaps with the one above', moveNavigationItem(three, 1, 'up').map((l) => l.label).join('') === 'BAC')
ok('moving down swaps with the one below', moveNavigationItem(three, 1, 'down').map((l) => l.label).join('') === 'ACB')
ok('moving the first item up changes nothing', moveNavigationItem(three, 0, 'up').map((l) => l.label).join('') === 'ABC')
ok('moving the last item down changes nothing', moveNavigationItem(three, 2, 'down').map((l) => l.label).join('') === 'ABC')
ok('a hidden link is not rendered', visibleNavigation([link('A', '/a'), link('B', '/b', false)]).length === 1)
ok('no menu says so', /standard menu/.test(describeNavigation([])))
ok('hidden links are counted', /1 hidden/.test(describeNavigation([link('A', '/a'), link('B', '/b', false)])))

// --- the boundary: it is saved, validated and rendered, not just stored ---
const settings = readFileSync(join(root, 'src/app/api/dashboard/settings/route.ts'), 'utf8')
ok('the save endpoint validates the menu', settings.includes('validateNavigation('))
ok('the save endpoint normalises before writing', settings.includes('normaliseNavigation('))
ok('the menu is not blindly whitelisted', !settings.includes("'navigation', 'homeModules'"))
const versions = readFileSync(join(root, 'src/lib/website-versions.ts'), 'utf8')
ok('the menu is part of a published snapshot', versions.includes("'navigation'"))
const layout = readFileSync(join(root, 'src/app/(customer)/layout.tsx'), 'utf8')
ok('the public site passes the stored menu', layout.includes('parseNavigation('))
const navbar = readFileSync(join(root, 'src/components/customer/Navbar.tsx'), 'utf8')
ok('the navbar renders the custom menu', navbar.includes('visibleNavigation('))
ok('the navbar keeps its standard menu as the fallback', navbar.includes('standardLinks'))
const editor = readFileSync(join(root, 'src/components/dashboard/WebsiteNavigationEditor.tsx'), 'utf8')
ok('the editor announces results to a screen reader', editor.includes('aria-live'))
ok('the editor marks errors as alerts', editor.includes('role="alert"'))
ok('the editor has touch sized controls', editor.includes('min-h-11'))
ok('the editor never injects markup', !editor.includes('dangerouslySetInnerHTML'))

assert.ok(p > 0)
console.log(`\nWebsite navigation: ${p} passed, ${f} failed`)
if (f > 0) process.exit(1)
