import { buildShareLink } from '../src/lib/barber/share-link'
import { verifyReferral } from '../src/lib/growth/barber-links'

let p = 0, f = 0
const ok = (n: string, c: boolean, d = '') => { if (c) p++; else { f++; console.log('  FAIL', n, d) } }
process.env.NEXTAUTH_SECRET = 'test-secret-value'

const base = { appUrl: 'https://shop.example.com', barberSlug: 'marcus', businessId: 'biz1', barberId: 'bar1' }
const link = buildShareLink(base)
ok('a link is built', !!link)
ok('it points at the barber page', !!link && link.url.startsWith('https://shop.example.com/barbers/marcus'))
ok('it carries a referral token', !!link && link.url.includes('?ref='))
ok('the note says who gets credit', !!link && /credited to you/.test(link.note))

const token = decodeURIComponent(link!.url.split('ref=')[1])
const v = verifyReferral(token)
ok('the token verifies', !!v)
ok('it names the right barber', v?.barberId === 'bar1')
ok('it names the right shop', v?.businessId === 'biz1')

ok('no barber slug means no link', buildShareLink({ ...base, barberSlug: null }) === null)
ok('no app url means no link', buildShareLink({ ...base, appUrl: '' }) === null)
ok('a javascript: base is refused', buildShareLink({ ...base, appUrl: 'javascript:alert(1)' }) === null)
ok('a dashboard path is refused', buildShareLink({ ...base, barberSlug: 'x/../../dashboard' }) === null)

const saved = process.env.NEXTAUTH_SECRET
delete process.env.NEXTAUTH_SECRET
ok('without a secret no link is issued', buildShareLink(base) === null)
process.env.NEXTAUTH_SECRET = saved

console.log('\nBarber share link: ' + p + ' passed, ' + f + ' failed')
process.exit(f === 0 ? 0 : 1)
