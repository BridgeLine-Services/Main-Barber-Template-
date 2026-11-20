/**
 * URL and text checks that must not be fooled.
 *
 * Every case here is one a substring check gets wrong: the trusted name appears
 * inside a query string, the trusted name appears inside a lookalike host, the
 * scheme is not https, the URL carries credentials, or a tag survives one pass of
 * stripping. These are regression tests for real CodeQL findings.
 */

import {
  parseHttpsUrl,
  hostOf,
  isHostOfDomain,
  isSafeExternalUrl,
  stripHtmlTags,
  hostOfAnyUrl,
} from '../src/lib/safe-url'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

// ─── What is accepted ──────────────────────────────────────────────────────

ok('a plain https URL is accepted', isSafeExternalUrl('https://example.com/path?q=1'))
ok('its host is returned lowercased', hostOf('https://Example.COM/x') === 'example.com')
ok('a subdomain is recognised as the domain', isHostOfDomain('https://docs.example.com', 'example.com'))
ok('the domain itself is recognised', isHostOfDomain('https://example.com', 'example.com'))
ok('a www host is recognised', isHostOfDomain('https://www.example.com', 'example.com'))
ok('a port does not hide the host', hostOf('https://example.com:8443/x') === 'example.com')

// ─── What is refused ───────────────────────────────────────────────────────

ok('javascript: is refused', !isSafeExternalUrl('javascript:alert(1)'))
ok('JaVaScRiPt: is refused', !isSafeExternalUrl('JaVaScRiPt:alert(1)'))
ok('data: is refused', !isSafeExternalUrl('data:text/html,<script>alert(1)</script>'))
ok('http: is refused', !isSafeExternalUrl('http://example.com'))
ok('a protocol-relative URL is refused', !isSafeExternalUrl('//example.com'))
ok('a relative path is refused', !isSafeExternalUrl('/dashboard'))
ok('an empty string is refused', !isSafeExternalUrl(''))
ok('whitespace is refused', !isSafeExternalUrl('   '))
ok('null is refused', !isSafeExternalUrl(null))
ok('a malformed URL is refused', !isSafeExternalUrl('https://'))

// ─── The substring traps ───────────────────────────────────────────────────

ok('the trusted name in a query string is not the host', hostOf('https://evil.test/?next=https://example.com') === 'evil.test')
ok('a lookalike host is not the domain', !isHostOfDomain('https://example.com.evil.test', 'example.com'))
ok('a suffix without a dot boundary is not the domain', !isHostOfDomain('https://notexample.com', 'example.com'))
ok('a hyphenated lookalike is not the domain', !isHostOfDomain('https://evil-example.com', 'example.com'))
ok('credentials in the URL are refused', !isSafeExternalUrl('https://user:pass@example.com'))
ok('a host inside the path is not the host', hostOf('https://evil.test/example.com') === 'evil.test')
ok('an encoded host is not decoded into trust', !isHostOfDomain('https://example%2Ecom.evil.test', 'example.com'))

// ─── Tag stripping survives one pass ───────────────────────────────────────

ok('a plain tag is removed', stripHtmlTags('<b>Save</b>') === 'Save')
ok('nested angle brackets cannot smuggle a tag', stripHtmlTags('<<b>script>') === '')
ok('a script tag with content is stripped of markup', stripHtmlTags('<script>x</script>').trim() === 'x')
ok('text is left alone', stripHtmlTags('Book now') === 'Book now')
ok('an empty button stays empty', stripHtmlTags('<span></span>').trim() === '')
ok('the loop is bounded on hostile input', stripHtmlTags('<'.repeat(500)).length >= 0)

// ─── Any-scheme host parsing (connection strings) ──────────────────────────

ok('a postgres URL yields its host', hostOfAnyUrl('postgresql://u:p@db.example.com:5432/x') === 'db.example.com')
ok('a redacted postgres URL still yields its host', hostOfAnyUrl('postgresql://u:***@db.example.com:5432/x') === 'db.example.com')
ok('a lookalike host in a connection string is not confused', hostOfAnyUrl('postgresql://u:p@db.example.com.evil.test/x') === 'db.example.com.evil.test')
ok('javascript: yields no host', hostOfAnyUrl('javascript:alert(1)') === null)
ok('a relative path yields no host', hostOfAnyUrl('/dashboard') === null)

// ─── The helpers never throw ───────────────────────────────────────────────

for (const value of ['', 'https://', 'https://[', 'https://a b c', '::::', '%%%']) {
  let threw = false
  try { parseHttpsUrl(value) } catch { threw = true }
  ok(`parse does not throw on ${JSON.stringify(value)}`, !threw)
}

console.log(`\nSafe URL helpers: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
