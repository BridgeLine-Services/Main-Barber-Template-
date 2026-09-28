/**
 * Section: File Management hardening (upload content validation).
 *
 * Proves the upload pipeline never trusts the client-declared MIME type:
 *  - magic-byte sniffing for JPEG / PNG / WebP / AVIF
 *  - spoofed Content-Type is rejected (declared != actual)
 *  - non-image binaries (e.g. PHP/shell/HTML payloads) are rejected
 *  - SVGs are sanitized: scripts, event handlers, javascript:/vbscript:
 *    URLs and foreignObject content are stripped; external entities reject
 *
 * Run: npx tsx tests/file-validation.test.ts  (no server or database needed)
 */

import {
  sniffImageType,
  sanitizeSvg,
  validateImageUpload,
  MIME_TO_EXTENSION,
} from '../src/lib/file-validation'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}
function expectThrow(fn: () => unknown, message: string) {
  try { fn(); assert(false, message) } catch { assert(true, message) }
}

// ─── helpers: minimal valid files of each type ──────────────────────────────

function jpegBuf(): Uint8Array {
  const buf = new Uint8Array(64)
  buf.set([0xff, 0xd8, 0xff, 0xe0], 0)
  buf.set([0xff, 0xd9], buf.length - 2)
  return buf
}
function pngBuf(): Uint8Array {
  const buf = new Uint8Array(64)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}
function webpBuf(): Uint8Array {
  const buf = new Uint8Array(32)
  buf.set([0x52, 0x49, 0x46, 0x46], 0) // "RIFF"
  buf.set([0x57, 0x45, 0x42, 0x50], 8) // "WEBP"
  return buf
}
function avifBuf(): Uint8Array {
  const buf = new Uint8Array(32)
  buf.set([0x00, 0x00, 0x00, 0x18], 0)
  buf.set([0x66, 0x74, 0x79, 0x70], 4) // "ftyp"
  buf.set([0x61, 0x76, 0x69, 0x66], 8) // "avif"
  return buf
}
function svgBuf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

console.log('magic-byte sniffing')
assert(sniffImageType(jpegBuf()) === 'image/jpeg', 'JPEG detected by magic bytes')
assert(sniffImageType(pngBuf()) === 'image/png', 'PNG detected by magic bytes')
assert(sniffImageType(webpBuf()) === 'image/webp', 'WebP detected by RIFF/WEBP header')
assert(sniffImageType(avifBuf()) === 'image/avif', 'AVIF detected by ftyp box brand')
assert(sniffImageType(svgBuf('<svg xmlns="http://www.w3.org/2000/svg"></svg>')) === 'image/svg+xml', 'SVG detected as text/svg')
assert(sniffImageType(svgBuf('<?xml version="1.0"?>\n<!-- icon -->\n<svg viewBox="0 0 1 1"><rect/></svg>')) === 'image/svg+xml', 'SVG with xml decl + comment detected')
assert(sniffImageType(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])) === null, 'MP4 ftyp rejected (not an allowed image)')
assert(sniffImageType(new TextEncoder().encode('<h1>not an image</h1>')) === null, 'HTML text rejected')
assert(sniffImageType(new Uint8Array(4)) === null, 'Truncated buffer rejected')
assert(sniffImageType(new TextEncoder().encode('<?php system($_GET["cmd"]); ?>')) === null, 'PHP payload rejected')

console.log('spoofed Content-Type rejected')
expectThrow(() => validateImageUpload('image/png', svgBuf('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'PNG-declared SVG rejected (mismatch)')
expectThrow(() => validateImageUpload('image/jpeg', pngBuf()), 'JPEG-declared PNG rejected (mismatch)')
expectThrow(() => validateImageUpload('image/png', new TextEncoder().encode('<?php echo 1; ?>')), 'PNG-declared PHP payload rejected')
expectThrow(() => validateImageUpload('application/x-sh', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 0, 0, 0, 0])), 'shell ELF binary rejected')

console.log('legitimate uploads pass')
{
  const v = validateImageUpload('image/png', pngBuf())
  assert(v.contentType === 'image/png' && MIME_TO_EXTENSION[v.contentType] === 'png', 'PNG validated with correct extension')
}
{
  const v = validateImageUpload('image/svg+xml', svgBuf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1"/></svg>'))
  assert(v.contentType === 'image/svg+xml', 'clean SVG passes validation')
}

console.log('SVG sanitization')
{
  const clean = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onmouseover="alert(2)"/><a href="javascript:alert(3)"><text>x</text></a></svg>')
  assert(clean !== null, 'SVG with script/handler/js-url sanitizes instead of crashing')
  assert(clean !== null && !/<script/i.test(clean), 'script block stripped')
  assert(clean !== null && !/onmouseover/i.test(clean), 'event handler attribute stripped')
  assert(clean !== null && !/javascript:/i.test(clean), 'javascript: href stripped')
  assert(clean !== null && /<rect/.test(clean), 'legitimate shape preserved')
}
assert(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body><script>alert(1)</script></body></foreignObject></svg>') === null, 'SVG relying on foreignObject content is rejected (cannot be sanitized safely)')
assert(sanitizeSvg('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>') === null, 'SVG with external entity rejected (XXE vector)')
assert(sanitizeSvg('<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"/>') !== null, 'SVG with top-level onload sanitized to safe output')
assert(sanitizeSvg('') === null, 'empty SVG rejected')
assert(sanitizeSvg('<div>not svg</div>') === null, 'non-SVG markup rejected by sanitizer')
{
  // sanitizer output is actually what gets stored: validate returns cleaned bytes
  const v = validateImageUpload('image/svg+xml', svgBuf('<svg xmlns="http://www.w3.org/2000/svg"><circle onclick="evil()"/></svg>'))
  assert(v.buffer.toString('utf-8') === '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>', 'stored SVG is the sanitized version, not the original')
}

console.log('')
console.log(`file-validation: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
