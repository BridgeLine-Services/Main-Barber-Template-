/**
 * Turning a stored photo value into an <img src>.
 *
 * One job, done in one place: a value is parsed and rebuilt, or refused. Anything the
 * browser could read as something other than a raster image never reaches the attribute.
 * Extracted from the form so it can be tested directly, which a component-private
 * function could not be without widening the component's public surface.
 */

// The preview shows a value that arrives from a file picker or from the saved record.
// It is parsed, not merely pattern-matched, and only the normalised href is rendered, so
// the browser is never handed a string this code has not understood. A blob created by
// this page for a freshly picked file, a raster data: image and an ordinary http(s) URL
// are allowed; anything else (including a malformed value) renders nothing at all.
export function photoPreviewSrc(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // A blob URL is one this page made for a file the user just picked.
  if (trimmed.startsWith('blob:')) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      // Rebuilt from parsed parts rather than passed through, so the attribute never
      // receives a string that was not understood first.
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`
    }
    if (parsed.protocol === 'data:') {
      // Anchored and fully specified: a base64 raster image and nothing else. The
      // earlier version accepted any `data:image/png;` prefix, which leaves room for a
      // payload the browser could read as something other than an image.
      const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(trimmed)
      return match ? `data:image/${match[1].toLowerCase()};base64,${match[2]}` : null
    }
  } catch {
    return null
  }
  return null
}

/**
 * Final check before a preview reaches an <img> src. It repeats the scheme rules rather
 * than trusting the earlier parse, so a future refactor of photoPreviewSrc cannot turn
 * this attribute into a way to hand the browser an unparsed string.
 */
export function isRenderableImageSrc(value: string): boolean {
  if (value.startsWith('blob:')) return value.length > 'blob:'.length
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true
    return parsed.protocol === 'data:' && /^data:image\/(png|jpe?g|webp|gif);/i.test(value)
  } catch {
    return false
  }
}
