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
// ── Malicious SVG corpus ────────────────────────────────────────────────────
// Every case here is something a stored SVG could use to run code, contact an
// external host, or smuggle active content past a stripping pass. The parser
// rebuilds each document from an allowlist, so the assertion is the same for
// all of them: whatever comes back must contain none of it.
console.log('SVG active-content corpus')
{
  const NS = 'xmlns="http://www.w3.org/2000/svg"'
  const clean = (svg: string) => {
    const out = sanitizeSvg(svg)
    return out === null ? '' : out
  }
  const dangerous = (svg: string, label: string) => {
    const out = clean(svg)
    assert(!/<script/i.test(out) && !/on[a-z]+\s*=/i.test(out) && !/javascript:/i.test(out)
      && !/vbscript:/i.test(out) && !/foreignobject/i.test(out) && !/<image/i.test(out)
      && !/<use/i.test(out) && !/http:\/\//i.test(out.replace('http://www.w3.org/2000/svg', ''))
      && !/<!entity/i.test(out) && !/animate/i.test(out),
      label + ': no active content survives')
  }

  dangerous(`<svg ${NS}><ScRiPt>alert(1)</ScRiPt><rect width="1" height="1"/></svg>`, 'mixed-case script')
  dangerous(`<svg ${NS}><rect width="1" height="1" ONLOAD="alert(1)"/></svg>`, 'uppercase event handler')
  dangerous(`<svg ${NS}><rect width="1" height="1" onfocusin="alert(1)"/></svg>`, 'less common event handler')
  dangerous(`<svg ${NS}><a href="javascript:alert(1)"><text>x</text></a></svg>`, 'javascript href')
  dangerous(`<svg ${NS}><a href="vbscript:msgbox(1)"><text>x</text></a></svg>`, 'vbscript href')
  dangerous(`<svg ${NS}><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`, 'namespaced javascript href')
  dangerous(`<svg ${NS}><image href="https://evil.example/pixel.png"/></svg>`, 'external image reference')
  dangerous(`<svg ${NS}><use href="https://evil.example/sprite.svg#x"/></svg>`, 'external use reference')
  dangerous(`<svg ${NS}><style>@import url(https://evil.example/x.css);</style><rect/></svg>`, 'external stylesheet')
  dangerous(`<svg ${NS}><animate attributeName="href" to="javascript:alert(1)"/></svg>`, 'animation element')
  dangerous(`<svg ${NS}><set attributeName="onload" to="alert(1)"/></svg>`, 'set element')
  dangerous(`<svg ${NS}><handler/></svg>`, 'SVG handler element')
  dangerous(`<svg ${NS}><rect width="1" height="1" style="background:url(javascript:alert(1))"/></svg>`, 'style attribute')
  // A decoded scheme sitting in TEXT content is inert: it is not an attribute
  // and the browser never executes it. What matters is that it stays text and
  // does not become a link or a handler.
  {
    const t = clean(`<svg ${NS}><text>&#106;avascript:alert(1)</text></svg>`)
    assert(t.length > 0 && !/href\s*=|xlink:href|on[a-z]+\s*=/i.test(t), 'entity-encoded text stays inert text, not an attribute')
  }

  // The attribute-visibility cases: these use encoding or casing to slip past a
  // naive denylist. They must be absent from the rebuilt document.
  dangerous(`<svg ${NS}><a xlink:href=" java&#115;cript:alert(1)"><text>x</text></a></svg>`, 'entity-encoded scheme')
  dangerous(`<svg ${NS}><a href="JaVaScRiPt:alert(1)"><text>x</text></a></svg>`, 'mixed-case scheme')

  // Rejected outright: cannot be rebuilt into the same picture.
  assert(sanitizeSvg(`<svg ${NS}><foreignObject><div>x</div></foreignObject></svg>`) === null, 'foreignObject rejects the document')
  assert(sanitizeSvg('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>') === null, 'DOCTYPE rejects the document')
  {
    // An undeclared entity must never be resolved. Either the document is
    // refused, or the reference survives only as escaped text.
    const x = sanitizeSvg(`<svg ${NS}>&xxe;</svg>`)
    assert(x === null || !x.includes('&xxe;'), 'unknown entity is never resolved into content')
  }
  assert(sanitizeSvg(`<svg ${NS}>` + '<g>'.repeat(60) + '</g>'.repeat(60) + '</svg>') === null, 'pathologically nested document rejected')
  assert(sanitizeSvg(`<svg ${NS}>` + '<rect/>'.repeat(6000) + '</svg>') === null, 'oversized node count rejected')
  assert(sanitizeSvg(`<svg ${NS}><rect></svg>`) === null, 'malformed XML rejected')
  assert(sanitizeSvg('not xml at all') === null, 'non-XML rejected')
  assert(sanitizeSvg(`<svg ${NS}>` + 'a'.repeat(120000) + '</svg>') === null, 'oversized document rejected')

  // Legitimate artwork still survives intact.
  const logo = sanitizeSvg(`<svg ${NS} viewBox="0 0 24 24"><defs><linearGradient id="g1"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs><g fill="url(#g1)"><path d="M1 1 L2 2"/><circle cx="3" cy="3" r="1"/></g><text x="0" y="10">Joes Barbershop</text></svg>`)
  assert(logo !== null, 'clean logo survives sanitization')
  assert(!!logo && /<path /.test(logo), 'paths preserved')
  assert(!!logo && /<linearGradient /.test(logo), 'gradients preserved')
  assert(!!logo && /<text /.test(logo) && logo.includes('Joes Barbershop'), 'text preserved')
  assert(!!logo && /fill="url\(#g1\)"/.test(logo), 'internal paint reference preserved')

  // The upload pipeline rejects rather than storing anything it cannot clean.
  expectThrow(() => validateImageUpload('image/svg+xml', svgBuf(`<svg ${NS}><foreignObject><div>x</div></foreignObject></svg>`)),
    'upload of unsanitizable SVG is refused with a user-facing message')
}

console.log(`\nfile-validation: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
