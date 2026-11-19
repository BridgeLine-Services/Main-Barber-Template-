import QRCode from 'qrcode'

/**
 * A QR code for a barber's booking link.
 *
 * The encoding is done by the `qrcode` package, not by hand: Reed-Solomon error
 * correction is not something to write from scratch into a system that holds customer
 * data. What lives here is the part that library must not decide for us — what is
 * allowed to be encoded at all.
 */

/** Beyond this a code stops being scannable from a printed card. */
export const MAX_QR_PAYLOAD = 512

export function isEncodableLink(url: string | null | undefined): url is string {
  if (!url) return false
  const trimmed = url.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_QR_PAYLOAD) return false
  // Only real links. A QR code pointing at javascript: or data: is a weapon, not a card.
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return false
  return true
}

export interface QrOptions {
  width?: number
}

export async function buildQrDataUrl(url: string | null | undefined, options: QrOptions = {}): Promise<string | null> {
  if (!isEncodableLink(url)) return null
  try {
    return await QRCode.toDataURL(url.trim(), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: options.width ?? 256,
    })
  } catch {
    // A code that cannot be generated is not a code. Never fall back to something partial.
    return null
  }
}

/** Alt text and caption a screen-reader user gets instead of the image. */
export function describeQr(url: string | null | undefined): string {
  return isEncodableLink(url)
    ? 'QR code that opens your booking link. The link below works without a camera.'
    : 'QR code not available yet.'
}
