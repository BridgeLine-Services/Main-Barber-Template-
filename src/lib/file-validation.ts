import { DOMParser } from '@xmldom/xmldom'

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

// ---------------------------------------------------------------------------
// SVG sanitization: parse, then rebuild from an allowlist.
//
// The previous implementation was a set of regular expressions that stripped
// known-bad patterns. That approach fails in two directions: a pattern it does
// not know about survives, and a single pass can leave a dangerous fragment
// behind that only becomes dangerous after the browser re-parses it.
//
// This implementation parses the document as XML, discards everything that is
// not explicitly allowed, and serializes a fresh document from the allowed
// nodes. Nothing from the input is copied through verbatim, so a construct the
// allowlist has never heard of cannot reach the browser.
// ---------------------------------------------------------------------------

/** Hard cap on the raw document, checked before any parsing work. */
const MAX_SVG_CHARS = 100_000
/** Hard cap on emitted nodes, so a small input cannot expand into a huge one. */
const MAX_SVG_NODES = 5_000
/** Nesting limit; real logos are shallow, deeply nested input is not a logo. */
const MAX_SVG_DEPTH = 32

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** Elements a logo or icon can legitimately need. Everything else is dropped. */
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'pattern',
  'clipPath', 'mask', 'marker',
])

/**
 * Elements that cannot be saved by stripping attributes and that signal the
 * document was not an ordinary logo. A document containing one is rejected
 * outright rather than quietly altered, because the result would not be the
 * picture the owner uploaded.
 *
 * Everything else that is not on the allowlist (script, style, handler,
 * animation, image, use, external references) is dropped with its subtree by
 * the serializer: the shapes around it are kept and the active content never
 * reaches the output.
 */
const REJECTED_ELEMENTS = new Set(['foreignobject'])

/** Presentation attributes that carry no script or URL semantics. */
const ALLOWED_ATTRIBUTES = new Set([
  'xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'version',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points',
  'd', 'pathLength',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity',
  'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform', 'transform-origin',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'patternUnits', 'patternContentUnits', 'patternTransform',
  'clip-path', 'clipPathUnits', 'mask', 'maskUnits', 'maskContentUnits',
  'marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight',
  'markerUnits', 'refX', 'refY', 'orient',
  'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
  'text-anchor', 'dominant-baseline', 'textLength', 'dx', 'dy',
  'id', 'class', 'role', 'aria-label', 'aria-hidden', 'focusable',
])

interface SvgNode {
  nodeType: number
  tagName?: string
  nodeName?: string
  namespaceURI?: string | null
  childNodes: ArrayLike<SvgNode>
  attributes?: ArrayLike<{ name: string; value: string } & SvgNode>
  nodeValue?: string | null
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

function escapeSvgText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeSvgAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * A URL-bearing attribute may only point inside the document itself. External
 * references would let a stored SVG call out to another host when rendered.
 */
function isSafeInternalReference(value: string): boolean {
  const v = value.trim()
  if (!v.startsWith('#')) return false
  return /^#[A-Za-z0-9_.:-]{1,128}$/.test(v)
}

/** Paint values: colours and "none", plus the handful of keywords SVG defines. */
function isSafePaint(value: string): boolean {
  const v = value.trim()
  if (v.length > 64) return false
  if (/^#(?:[0-9a-f]{3,8})$/i.test(v)) return true
  if (/^[a-z]+$/i.test(v)) return true
  if (/^(?:rgba?|hsla?)\([0-9.,%\s]{1,60}\)$/i.test(v)) return true
  if (/^url\(#[-A-Za-z0-9_.:]{1,128}\)$/.test(v)) return true
  return false
}

function serializeElement(node: SvgNode, out: string[], state: { nodes: number }, depth: number): boolean {
  if (state.nodes++ > MAX_SVG_NODES) return false
  if (depth > MAX_SVG_DEPTH) return false

  const attrs: string[] = []
  const attributeList = node.attributes
  if (attributeList) {
    for (let i = 0; i < attributeList.length; i++) {
      const attr = attributeList[i]
      if (!attr || typeof attr.name !== 'string') continue
      const name = attr.name
      const lower = name.toLowerCase()
      const value = typeof attr.value === 'string' ? attr.value : ''
      // Event handlers and any namespaced attribute are dropped, never rewritten.
      if (lower.startsWith('on')) continue
      if (name.includes(':')) {
        // Only xlink:href is meaningful, and only when it points at a local id.
        if (lower === 'xlink:href' && isSafeInternalReference(value)) attrs.push(`href="${escapeSvgAttribute(value)}"`)
        else if (lower === 'xml:space' && /^(?:default|preserve)$/i.test(value.trim())) attrs.push(`xml:space="${escapeSvgAttribute(value)}"`)
        continue
      }
      if (!ALLOWED_ATTRIBUTES.has(name)) {
        // href is only allowed as an internal reference.
        if (lower === 'href' && isSafeInternalReference(value)) attrs.push(`href="${escapeSvgAttribute(value)}"`)
        continue
      }
      if (lower === 'fill' || lower === 'stroke' || lower === 'stop-color') {
        if (!isSafePaint(value)) continue
      }
      if (value.length > 4000) continue
      attrs.push(`${name}="${escapeSvgAttribute(value)}"`)
    }
  }

  const tag = node.tagName as string
  const inner: string[] = []
  const children = node.childNodes
  for (let i = 0; children && i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    if (child.nodeType === TEXT_NODE) {
      const text = child.nodeValue ?? ''
      if (text.trim()) inner.push(escapeSvgText(text))
      continue
    }
    if (child.nodeType !== ELEMENT_NODE) continue
    const rawTag = (child.tagName || child.nodeName || '').toLowerCase()
    if (REJECTED_ELEMENTS.has(rawTag)) return false
    if (!ALLOWED_ELEMENTS.has(child.tagName as string)) continue
    if (child.namespaceURI && child.namespaceURI !== SVG_NAMESPACE) return false
    if (!serializeElement(child, inner, state, depth + 1)) return false
  }

  const open = attrs.length ? `<${tag} ${attrs.join(' ')}` : `<${tag}`
  // Empty elements are emitted self-closing, which is what the stored files and
  // the existing tests expect.
  if (inner.length === 0) out.push(`${open}/>`)
  else out.push(`${open}>${inner.join('')}</${tag}>`)
  return true
}

/**
 * Sanitize an SVG document. Returns a freshly built SVG string, or null when
 * the document cannot be confidently sanitized (malformed XML, a rejected
 * element, an entity declaration, an oversized input). Null means reject.
 */
export function sanitizeSvg(text: string): string | null {
  if (typeof text !== 'string') return null
  if (!text || !text.trim()) return null
  if (text.length > MAX_SVG_CHARS) return null

  const input = text.replace(/^\uFEFF/, '')

  // Reject DTD/entity constructs before the parser ever sees them: they are the
  // XXE surface, and a legitimate logo never needs one.
  if (/<!DOCTYPE/i.test(input) || /<!ENTITY/i.test(input) || /SYSTEM\s+["']/i.test(input)) return null

  let root: SvgNode | undefined
  try {
    // xmldom 0.9 takes a single callback, not the legacy per-level object, and
    // it writes parse complaints there. Silence them: the document is either
    // rebuilt successfully below or rejected outright.
    const quiet = () => undefined
    const doc = new DOMParser({ errorHandler: quiet }).parseFromString(input, 'image/svg+xml')
    root = doc?.documentElement ?? undefined
  } catch {
    return null
  }

  if (!root) return null
  const rootTag = (root.tagName || '').toLowerCase()
  if (rootTag !== 'svg') return null
  if (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE) return null

  const out: string[] = []
  if (!serializeElement(root, out, { nodes: 0 }, 0)) return null

  const result = out.join('')
  return result.length > 0 ? result : null
}

/**
 * The result of a successful upload validation: the content type we trust
 * (derived from the bytes, never from the request header) and the bytes to
 * store — sanitized when the input was an SVG.
 */
export interface ValidatedFile {
  contentType: AllowedImageType
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
