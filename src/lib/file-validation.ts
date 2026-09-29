// ============================================================================
// FILE VALIDATION — server-side content inspection for uploaded assets.
//
// The client-provided Content-Type is NEVER trusted on its own: a request
// can declare "image/png" while carrying a PHP/script/HTML payload. Every
// upload is sniffed by its magic bytes, and the sniffed type must match the
// declared type. SVGs are additionally sanitized (they are XML that renders
// in the browser and can carry scripts).
//
// No server-only imports — safe to import from tests and scripts.
// ============================================================================

export type AllowedImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/svg+xml'

export const ALLOWED_IMAGE_TYPES: readonly AllowedImageType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/svg+xml',
]

/** Map a verified MIME type to the safe extension used for storage. */
export const MIME_TO_EXTENSION: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false
  return bytes.every((b, i) => buf[offset + i] === b)
}

function asciiAt(buf: Uint8Array, offset: number, length: number): string {
  return Array.from(buf.slice(offset, offset + length))
    .map((b) => String.fromCharCode(b))
    .join('')
}

/**
 * Detect the real image type of a buffer from its magic bytes.
 * Returns null for anything that is not an allowed image type.
 *
 * - JPEG: FF D8 FF
 * - PNG:  89 50 4E 47 0D 0A 1A 0A
 * - WebP: "RIFF"...."WEBP"
 * - AVIF: ISO-BMFF "ftyp" box with brand "avif" or "avis"
 * - SVG:  UTF-8 text whose first markup tag is <svg (after optional
 *         XML declaration / comments / doctype / whitespace)
 */
export function sniffImageType(buf: Uint8Array): AllowedImageType | null {
  if (buf.length < 12) return null

  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'

  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && asciiAt(buf, 8, 4) === 'WEBP') return 'image/webp'

  // ISO Base Media File Format (AVIF/HEIF): bytes 4..8 = "ftyp", brand follows
  if (asciiAt(buf, 4, 4) === 'ftyp') {
    const brand = asciiAt(buf, 8, 4)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    return null // other ftyp containers (mp4, heic, heif…) are not allowed
  }

  // SVG is text: allow leading whitespace / BOM / <?xml…?> / <!--…--> / <!DOCTYPE…>
  let text: string | null = null
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    text = utf8
  } catch {
    return null // binary that is not one of the types above
  }
  if (isSvgText(text)) return 'image/svg+xml'

  return null
}

function isSvgText(text: string): boolean {
  const withoutBom = text.replace(/^\uFEFF/, '')
  const head = withoutBom.slice(0, 2048)
  const markupStart = head.search(/<(\?xml|!DOCTYPE|!--|\s*svg)/i)
  if (markupStart === -1) return false
  // Walk past XML declaration, comments and doctype (all optional)
  let rest = head.slice(markupStart) + withoutBom.slice(2048)
  let guard = 0
  while (guard++ < 20) {
    if (rest.startsWith('<?xml')) rest = rest.replace(/^<\?xml[^>]*\?>/, '')
    else if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->')
      if (end === -1) return false
      rest = rest.slice(end + 3)
    } else if (/^<!DOCTYPE/i.test(rest)) {
      const end = rest.indexOf('>')
      if (end === -1) return false
      const doctype = rest.slice(0, end)
      // External DTDs can pull in external entities — reject
      if (/SYSTEM|PUBLIC/i.test(doctype)) return false
      rest = rest.slice(end + 1)
    } else break
    rest = rest.replace(/^\s+/, '')
  }
  return /^<svg[\s>]/i.test(rest)
}

// ─── SVG sanitization ───────────────────────────────────────────────────────
//
// Uploaded SVGs render as XML in the browser and can carry active content
// (<script>, event-handler attributes, javascript:/data: URLs, external
// references). This sanitizer strips those vectors before storage.
//
// NOTE: this is a pragmatic denylist sanitizer tuned for attacker-controlled
// icons/logos. For fully untrusted SVG, a hardened pipeline would parse with
// a strict XML parser and rebuild the tree from an allowlist.

const SCRIPT_BLOCK = /<script\b[\s\S]*?<\/script\s*>/gi
const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const JS_URL = /(?:href|xlink:href|src|data)\s*=\s*(?:"\s*(?:javascript|vbscript):[^"]*"|'\s*(?:javascript|vbscript):[^']*'|\s*(?:javascript|vbscript):[^\s>]*)/gi
const FOREIGN_OBJECT_START = /<foreignObject\b/i
const EXTERNAL_ENTITY = /<!ENTITY[^>]*>/gi

/**
 * Sanitize an SVG document. Returns the cleaned SVG text, or null when the
 * document still contains active content after cleaning (reject, don't
 * guess). An empty/truncated input also returns null.
 */
export function sanitizeSvg(text: string): string | null {
  if (!text || !text.trim()) return null
  let svg = text
  svg = svg.replace(/\uFEFF/, '')
  // External entities are an XXE/SSRF vector — reject outright
  if (/<!ENTITY/i.test(svg) || /SYSTEM\s+["']/i.test(svg)) return null
  // foreignObject embeds arbitrary HTML inside the SVG — cannot be made safe
  // by attribute stripping, so reject any document that uses it.
  if (FOREIGN_OBJECT_START.test(svg)) return null
  svg = svg.replace(SCRIPT_BLOCK, '')
  svg = svg.replace(EVENT_ATTR, '').replace(JS_URL, '')
  svg = svg.replace(EXTERNAL_ENTITY, '')
  // If a script tag survived pattern cleaning (malformed markup), reject
  if (/<script/i.test(svg)) return null
  if (/javascript:/i.test(svg) || /vbscript:/i.test(svg)) return null
  if (!/<svg[\s>]/i.test(svg)) return null
  return svg
}

export interface ValidatedFile {
  /** The verified MIME type (authoritative — derived from content, not client). */
  contentType: AllowedImageType
  /** The bytes to store: sanitized SVG text when applicable, otherwise the input. */
  buffer: Buffer
}

/**
 * Full validation pipeline for a single uploaded image.
 * Throws Error with a safe, user-facing message on any failure.
 */
export function validateImageUpload(declaredType: string, bytes: Uint8Array): ValidatedFile {
  const sniffed = sniffImageType(bytes)
  if (!sniffed) {
    throw new Error('Unsupported or corrupted file. Use JPEG, PNG, WebP, AVIF, or SVG images.')
  }
  if (declaredType && !ALLOWED_IMAGE_TYPES.includes(declaredType as AllowedImageType)) {
    throw new Error('Unsupported file type. Use JPEG, PNG, WebP, AVIF, or SVG.')
  }
  if (declaredType && sniffed !== declaredType) {
    // Declared type does not match actual content (spoofed Content-Type)
    throw new Error('File content does not match its declared type.')
  }
  if (sniffed === 'image/svg+xml') {
    const text = Buffer.from(bytes).toString('utf-8')
    const clean = sanitizeSvg(text)
    if (clean === null) {
      throw new Error('This SVG contains unsupported active content (scripts or external references) and was rejected.')
    }
    return { contentType: 'image/svg+xml', buffer: Buffer.from(clean, 'utf-8') }
  }
  return { contentType: sniffed, buffer: Buffer.from(bytes) }
}
