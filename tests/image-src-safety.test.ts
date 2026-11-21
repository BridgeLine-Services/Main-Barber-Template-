/**
 * The barber photo preview is the one place a stored value becomes an <img src>.
 *
 * It is a small function, so it is cheap to test properly: a value is either understood
 * and rebuilt, or refused. Nothing that could be read as anything other than a raster
 * image is allowed through.
 *
 * Run: npx tsx tests/image-src-safety.test.ts
 */

import { readFileSync } from 'node:fs'
import { photoPreviewSrc } from '../src/lib/safe-image-src'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const source = readFileSync('src/components/dashboard/BarberForm.tsx', 'utf8')

const PNG_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

ok(photoPreviewSrc(PNG_B64) === PNG_B64, 'a base64 PNG is accepted and unchanged')
ok(photoPreviewSrc('https://cdn.example.com/a.png') === 'https://cdn.example.com/a.png', 'an https image is accepted')
ok(photoPreviewSrc('https://cdn.example.com/a.png?x=1#frag') === 'https://cdn.example.com/a.png?x=1', 'the fragment is dropped, query kept')
ok(photoPreviewSrc('blob:https://app.example/1234') === 'blob:https://app.example/1234', 'a page-created blob is accepted')

ok(photoPreviewSrc('javascript:alert(1)') === null, 'a javascript: URL is refused')
ok(photoPreviewSrc('data:text/html;base64,PHNjcmlwdD4=') === null, 'an HTML data: URL is refused')
ok(photoPreviewSrc('data:image/svg+xml;base64,PHN2Zz4=') === null, 'an SVG data: URL is refused (it can carry script)')
ok(photoPreviewSrc('data:image/png;base64,<script>') === null, 'a data: URL with non-base64 content is refused')
ok(photoPreviewSrc('data:image/png;base64,AAAA")onerror=alert(1)') === null, 'a data: URL with an attribute break-out is refused')
ok(photoPreviewSrc('  ') === null, 'whitespace is refused')
ok(photoPreviewSrc(null) === null, 'null is refused')
ok(photoPreviewSrc(42) === null, 'a non-string is refused')
ok(photoPreviewSrc('not a url') === null, 'an unparseable value is refused')

ok(!/dangerouslySetInnerHTML/.test(source), 'the form never injects HTML')
ok(!/innerHTML\s*=/.test(source), 'the form never assigns innerHTML')

console.log(`\nImage src safety: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
