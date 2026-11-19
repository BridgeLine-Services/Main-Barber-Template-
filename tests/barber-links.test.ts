/** Priority 1 items 2 and 3: a barber's link, and attribution that cannot be forged. */
import { buildBarberLink, signReferral, verifyReferral, isSelfReferral } from '../src/lib/growth/barber-links'

let passed = 0
const failures: string[] = []
function ok(name: string, condition: boolean, detail = '') {
  if (condition) passed += 1
  else failures.push(`${name}${detail ? ' — ' + detail : ''}`)
}

process.env.NEXTAUTH_SECRET = 'test-only-secret'

// Links
ok('builds the barber page', buildBarberLink({ appUrl: 'https://shop.example', barberSlug: 'ana' }) === 'https://shop.example/barbers/ana')
ok('tolerates a trailing slash', buildBarberLink({ appUrl: 'https://shop.example/', barberSlug: 'ana' }) === 'https://shop.example/barbers/ana')
ok('refuses a non-http base', buildBarberLink({ appUrl: 'javascript:alert(1)', barberSlug: 'ana' }) === null)
ok('refuses a path-traversing slug', buildBarberLink({ appUrl: 'https://shop.example', barberSlug: '../admin' }) === null)
ok('refuses an empty slug', buildBarberLink({ appUrl: 'https://shop.example', barberSlug: '  ' }) === null)

// Tokens
const token = signReferral({ businessId: 'biz_1', barberId: 'bar_1' })
ok('signs a token', typeof token === 'string' && token!.length > 20)
const back = verifyReferral(token!)
ok('round-trips the tenant', back?.businessId === 'biz_1')
ok('round-trips the barber', back?.barberId === 'bar_1')
ok('token is not the payload in plain sight', !token!.includes('biz_1'))

const tampered = Buffer.from(Buffer.from(token!, 'base64url').toString('utf8').replace('bar_1', 'bar_2')).toString('base64url')
ok('rejects an edited barber id', verifyReferral(tampered) === null)
ok('rejects an edited tenant', verifyReferral(Buffer.from(Buffer.from(token!, 'base64url').toString('utf8').replace('biz_1', 'biz_9')).toString('base64url')) === null)
ok('rejects garbage', verifyReferral('not-a-token') === null)
ok('rejects an empty token', verifyReferral('') === null)
ok('rejects an expired token', verifyReferral(token!, 1000, Date.now() + 5000) === null)
ok('accepts a fresh token inside the window', verifyReferral(token!, 30 * 24 * 3600_000) !== null)

// Secrets
const saved = process.env.NEXTAUTH_SECRET
delete process.env.NEXTAUTH_SECRET
ok('refuses to sign without a secret', signReferral({ businessId: 'b', barberId: 'c' }) === null)
ok('refuses to verify without a secret', verifyReferral(token!) === null)
process.env.NEXTAUTH_SECRET = saved
ok('signing works again with a secret', signReferral({ businessId: 'b', barberId: 'c' }) !== null)

// Self-referral
ok('a customer referring themselves is not a referral', isSelfReferral('cust_1', 'cust_1'))
ok('a different customer is a referral', !isSelfReferral('cust_1', 'cust_2'))
ok('an unknown referrer is not a referral', !isSelfReferral(null, 'cust_1'))
ok('an anonymous visitor is not a referral', !isSelfReferral('cust_1', null))

if (failures.length) {
  console.error('FAILURES:')
  for (const f of failures) console.error('  ' + f)
}
console.log(`\nBarber links: ${passed} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
